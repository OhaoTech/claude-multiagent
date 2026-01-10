#!/bin/bash
# Usage: dispatch.sh <agent> "<task>"
# Dispatches a task to an agent headlessly, resumes their session

set -e

AGENT=$1
TASK=$2

if [ -z "$AGENT" ] || [ -z "$TASK" ]; then
    echo "Usage: dispatch.sh <agent> \"<task>\""
    echo "Agents: api, mobile, admin, pipeline, services"
    exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
LAB_DIR=$(dirname "$REPO_ROOT")

# Map agent to worktree directory
case $AGENT in
    api)      WORK_DIR="$LAB_DIR/fluxa-api" ; DOMAIN="apps/api" ;;
    mobile)   WORK_DIR="$LAB_DIR/fluxa-mobile" ; DOMAIN="apps/mobile" ;;
    admin)    WORK_DIR="$LAB_DIR/fluxa-admin" ; DOMAIN="apps/admin" ;;
    pipeline) WORK_DIR="$LAB_DIR/fluxa-pipeline" ; DOMAIN="scripts/content-pipeline" ;;
    services) WORK_DIR="$LAB_DIR/fluxa-services" ; DOMAIN="services" ;;
    *)        echo "Unknown agent: $AGENT"; exit 1 ;;
esac

# Verify worktree exists
if [ ! -d "$WORK_DIR" ]; then
    echo "ERROR: Worktree not found: $WORK_DIR"
    echo "Run: git worktree add --detach $WORK_DIR HEAD"
    exit 1
fi
RESULTS_DIR="$REPO_ROOT/.agent-mail/results/$AGENT"
COMMANDS_DIR="$REPO_ROOT/.agent-mail/commands"
TIMESTAMP=$(date +%s)

mkdir -p "$RESULTS_DIR"
mkdir -p "$COMMANDS_DIR"

# Check for pending commands for this agent
EXTRA_COMMANDS=""
for cmd_file in "$COMMANDS_DIR"/*-cmd.json; do
    if [ -f "$cmd_file" ]; then
        CMD_AGENT=$(jq -r '.agent // empty' "$cmd_file" 2>/dev/null)
        CMD_STATUS=$(jq -r '.status // empty' "$cmd_file" 2>/dev/null)
        if [ "$CMD_AGENT" = "$AGENT" ] && [ "$CMD_STATUS" = "pending" ]; then
            CMD_CONTENT=$(jq -r '.content // empty' "$cmd_file" 2>/dev/null)
            if [ -n "$CMD_CONTENT" ]; then
                EXTRA_COMMANDS="$EXTRA_COMMANDS\n- $CMD_CONTENT"
                # Mark as processed
                jq '.status = "processed"' "$cmd_file" > "${cmd_file}.tmp" && mv "${cmd_file}.tmp" "$cmd_file"
            fi
        fi
    fi
done

# Build system prompt for agent
read -r -d '' SYSTEM_PROMPT << EOF || true
You are the $AGENT agent for Fluxa.
Worktree: $WORK_DIR (your isolated working directory)
Focus domain: $DOMAIN/

FIRST: Read your context file:
cat $DOMAIN/AGENTS.md

TASK FROM LEADER:
$TASK
$(if [ -n "$EXTRA_COMMANDS" ]; then echo -e "\nADDITIONAL COMMANDS FROM MONITOR:$EXTRA_COMMANDS"; fi)

RULES:
1. Complete the task autonomously
2. Focus on files in your domain: $DOMAIN/
3. When done, write your results to: $RESULTS_DIR/$TIMESTAMP-result.md
4. Do NOT trigger or dispatch other agents
5. If you need another agent's help, note it in your results under "needs:"

RESULT FILE FORMAT (write to $RESULTS_DIR/$TIMESTAMP-result.md):
---
agent: $AGENT
status: success|failed|needs-help
needs: []
timestamp: $TIMESTAMP
---

## Summary
<what you did>

## Files Changed
<list of files modified>

## Notes for Leader
<anything the leader should know, including if other agents need to act>
EOF

# Update state - running
echo "{\"current\": \"$AGENT\", \"task\": \"$TASK\", \"started\": $TIMESTAMP}" > "$REPO_ROOT/.agent-mail/state.json"

echo "═══════════════════════════════════════════════════════════"
echo "DISPATCHING TO: $AGENT"
echo "TASK: $TASK"
echo "WORKTREE: $WORK_DIR"
echo "DOMAIN: $DOMAIN/"
echo "═══════════════════════════════════════════════════════════"

# Dispatch headlessly FROM AGENT'S DIRECTORY (separate session per agent)
cd "$WORK_DIR"

if timeout 1800 claude -p "$SYSTEM_PROMPT" \
    --continue \
    --max-turns 30 \
    --output-format json \
    --dangerously-skip-permissions \
    > "$RESULTS_DIR/$TIMESTAMP-output.json" 2>&1; then

    # Success
    echo "{\"current\": null, \"last\": \"$AGENT\", \"status\": \"success\", \"completed\": $(date +%s)}" > "$REPO_ROOT/.agent-mail/state.json"
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "✓ $AGENT COMPLETED"
    echo "Results: $RESULTS_DIR/$TIMESTAMP-result.md"
    echo "═══════════════════════════════════════════════════════════"
else
    # Failed
    EXIT_CODE=$?
    echo "{\"current\": null, \"last\": \"$AGENT\", \"status\": \"failed\", \"exit_code\": $EXIT_CODE, \"completed\": $(date +%s)}" > "$REPO_ROOT/.agent-mail/state.json"
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "✗ $AGENT FAILED (exit code: $EXIT_CODE)"
    echo "Check: $RESULTS_DIR/$TIMESTAMP-output.json"
    echo "═══════════════════════════════════════════════════════════"
    exit 1
fi
