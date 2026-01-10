#!/bin/bash
# Usage: dispatch.sh <agent> "<task>"
# Dispatches a task to an agent headlessly, resumes their session

set -e

AGENT=$1
TASK=$2

if [ -z "$AGENT" ] || [ -z "$TASK" ]; then
    echo "Usage: dispatch.sh <agent> \"<task>\""
    echo ""
    echo "Configure agents in .claude/agents.yaml"
    exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
PROJECT_NAME=$(basename "$REPO_ROOT")
LAB_DIR=$(dirname "$REPO_ROOT")
AGENTS_CONFIG="$REPO_ROOT/.claude/agents.yaml"

# Load agent config dynamically
if [ ! -f "$AGENTS_CONFIG" ]; then
    echo "ERROR: No agents config found at $AGENTS_CONFIG"
    echo "Create one with format:"
    echo "  agents:"
    echo "    api:"
    echo "      worktree: fluxa-api"
    echo "      domain: apps/api"
    exit 1
fi

# Parse agent config with python
AGENT_INFO=$(python3 << EOF
import yaml
from pathlib import Path

config = yaml.safe_load(Path("$AGENTS_CONFIG").read_text())
agents = config.get('agents', {})

if '$AGENT' not in agents:
    print("ERROR")
else:
    agent = agents['$AGENT']
    worktree = agent.get('worktree', f"$PROJECT_NAME-$AGENT")
    domain = agent.get('domain', '')
    print(f"{worktree}|{domain}")
EOF
)

if [ "$AGENT_INFO" = "ERROR" ]; then
    echo "Unknown agent: $AGENT"
    echo "Available agents:"
    python3 -c "import yaml; config=yaml.safe_load(open('$AGENTS_CONFIG')); print('  ' + '\n  '.join(config.get('agents', {}).keys()))"
    exit 1
fi

WORK_DIR="$LAB_DIR/$(echo "$AGENT_INFO" | cut -d'|' -f1)"
DOMAIN=$(echo "$AGENT_INFO" | cut -d'|' -f2)

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

# Get team context if workflow skill is available
TEAM_CONTEXT=""
WORKFLOW_SCRIPT="$REPO_ROOT/.claude/skills/workflow/scripts/team-context.sh"
if [ -x "$WORKFLOW_SCRIPT" ]; then
    TEAM_CONTEXT=$("$WORKFLOW_SCRIPT" 2>/dev/null || echo "")
fi

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
You are the $AGENT agent for $PROJECT_NAME.
Worktree: $WORK_DIR (your isolated working directory)
Focus domain: $DOMAIN/

FIRST: Read your context file if it exists:
cat $DOMAIN/AGENTS.md 2>/dev/null || echo "No AGENTS.md found"

TASK FROM LEADER:
$TASK
$(if [ -n "$EXTRA_COMMANDS" ]; then echo -e "\nADDITIONAL COMMANDS FROM MONITOR:$EXTRA_COMMANDS"; fi)

$(if [ -n "$TEAM_CONTEXT" ]; then echo "$TEAM_CONTEXT"; fi)

RULES:
1. Complete the task autonomously
2. Focus on files in your domain: $DOMAIN/
3. When done, write your results to: $RESULTS_DIR/$TIMESTAMP-result.md
4. Do NOT trigger or dispatch other agents
5. If you need another agent's help, note it in your results under "needs:"
6. Update your status when starting: .claude/skills/workflow/scripts/update-status.sh $AGENT working "$TASK"

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

# Update workflow status if available
UPDATE_SCRIPT="$REPO_ROOT/.claude/skills/workflow/scripts/update-status.sh"
if [ -x "$UPDATE_SCRIPT" ]; then
    "$UPDATE_SCRIPT" "$AGENT" working "$TASK" 2>/dev/null || true
fi

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

    # Update workflow status
    if [ -x "$UPDATE_SCRIPT" ]; then
        "$UPDATE_SCRIPT" "$AGENT" done "$TASK" 2>/dev/null || true
    fi

    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "✓ $AGENT COMPLETED"
    echo "Results: $RESULTS_DIR/$TIMESTAMP-result.md"
    echo "═══════════════════════════════════════════════════════════"
else
    # Failed
    EXIT_CODE=$?
    echo "{\"current\": null, \"last\": \"$AGENT\", \"status\": \"failed\", \"exit_code\": $EXIT_CODE, \"completed\": $(date +%s)}" > "$REPO_ROOT/.agent-mail/state.json"

    # Update workflow status
    if [ -x "$UPDATE_SCRIPT" ]; then
        "$UPDATE_SCRIPT" "$AGENT" blocked "$TASK" "Task failed with exit code $EXIT_CODE" 2>/dev/null || true
    fi

    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "✗ $AGENT FAILED (exit code: $EXIT_CODE)"
    echo "Check: $RESULTS_DIR/$TIMESTAMP-output.json"
    echo "═══════════════════════════════════════════════════════════"
    exit 1
fi
