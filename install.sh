#!/bin/bash
#
# Claude Code Multi-Agent System Installer
#
# Usage:
#   ./install.sh /path/to/repo                    # Install with default agents
#   ./install.sh /path/to/repo api frontend       # Install with custom agents
#   ./install.sh .                                # Install in current directory
#   curl ... | bash -s -- . api frontend backend  # Pipe install
#
# Creates:
#   .claude/skills/team-coord/scripts/dispatch.sh
#   .agent-mail/{inbox,results}/
#   Worktrees: ../repo-{agent}/

set -e

TARGET_REPO="${1:-.}"
shift 2>/dev/null || true
AGENTS=("$@")

# Default agents
if [ ${#AGENTS[@]} -eq 0 ]; then
    AGENTS=("api" "frontend" "backend")
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Claude Code Multi-Agent System Installer             ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Resolve target path
if [ "$TARGET_REPO" = "." ]; then
    TARGET_REPO="$(pwd)"
else
    TARGET_REPO="$(cd "$TARGET_REPO" 2>/dev/null && pwd)" || {
        echo -e "${RED}ERROR: Directory not found: $TARGET_REPO${NC}"
        exit 1
    }
fi

# Validate git repo
if [ ! -d "$TARGET_REPO/.git" ]; then
    echo -e "${RED}ERROR: Not a git repository: $TARGET_REPO${NC}"
    echo "Run: git init"
    exit 1
fi

cd "$TARGET_REPO"
REPO_NAME="$(basename "$TARGET_REPO")"
WORKTREE_BASE="$(dirname "$TARGET_REPO")"

echo "Target:  $TARGET_REPO"
echo "Agents:  ${AGENTS[*]}"
echo ""

# Create directories
echo -e "${GREEN}[1/5]${NC} Creating directory structure..."
mkdir -p .claude/skills/team-coord/scripts
mkdir -p .agent-mail/inbox
mkdir -p .agent-mail/results

# Create dispatch.sh
echo -e "${GREEN}[2/5]${NC} Installing dispatch.sh..."
cat > .claude/skills/team-coord/scripts/dispatch.sh << 'EOF'
#!/bin/bash
#═══════════════════════════════════════════════════════════════════════════════
# Claude Code Multi-Agent Dispatcher
#═══════════════════════════════════════════════════════════════════════════════
# Launches autonomous Claude agents in isolated git worktrees
#
# Usage:
#   dispatch.sh <agent> "task description"
#   dispatch.sh <agent> "task" [max_turns] [timeout_seconds]
#
# Examples:
#   dispatch.sh api "Add user authentication endpoint"
#   dispatch.sh frontend "Create dashboard page" 20 900
#═══════════════════════════════════════════════════════════════════════════════

set -e

AGENT="$1"
TASK="$2"
MAX_TURNS="${3:-30}"
TIMEOUT="${4:-1800}"

# ─────────────────────────────────────────────────────────────────────────────
# Configuration - EDIT THIS for your project
# ─────────────────────────────────────────────────────────────────────────────
declare -A AGENT_DOMAINS=(
    ["api"]="src/api/ apps/api/ server/"
    ["frontend"]="src/components/ src/pages/ apps/web/"
    ["backend"]="services/ workers/ scripts/"
    ["mobile"]="apps/mobile/ src/mobile/"
    ["devops"]="infrastructure/ .github/ deploy/"
)

# ─────────────────────────────────────────────────────────────────────────────
# Setup paths
# ─────────────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
REPO_NAME="$(basename "$REPO_ROOT")"
WORKTREE_BASE="$(dirname "$REPO_ROOT")"
WORKTREE_PATH="${WORKTREE_BASE}/${REPO_NAME}-${AGENT}"

# Validate inputs
if [ -z "$AGENT" ] || [ -z "$TASK" ]; then
    echo "Usage: dispatch.sh <agent> \"task description\""
    echo ""
    echo "Available agents:"
    for agent in "${!AGENT_DOMAINS[@]}"; do
        echo "  $agent -> ${AGENT_DOMAINS[$agent]}"
    done
    exit 1
fi

DOMAIN="${AGENT_DOMAINS[$AGENT]:-}"
if [ -z "$DOMAIN" ]; then
    echo "Warning: Unknown agent '$AGENT', will have full repo access"
    DOMAIN="(full repository)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Setup directories
# ─────────────────────────────────────────────────────────────────────────────
INBOX_DIR="${REPO_ROOT}/.agent-mail/inbox/${AGENT}"
RESULTS_DIR="${REPO_ROOT}/.agent-mail/results/${AGENT}"
mkdir -p "$INBOX_DIR" "$RESULTS_DIR"

TASK_ID="$(date +%s)"
TASK_FILE="${INBOX_DIR}/${TASK_ID}-task.md"
RESULT_FILE="${RESULTS_DIR}/${TASK_ID}-result.md"
OUTPUT_FILE="${RESULTS_DIR}/${TASK_ID}-output.json"

# ─────────────────────────────────────────────────────────────────────────────
# Create/verify worktree
# ─────────────────────────────────────────────────────────────────────────────
if [ ! -d "$WORKTREE_PATH" ]; then
    echo "Creating worktree: $WORKTREE_PATH"
    cd "$REPO_ROOT"
    BRANCH="${AGENT}-workspace"

    # Try to create new branch, or use existing
    git worktree add -b "$BRANCH" "$WORKTREE_PATH" HEAD 2>/dev/null || \
    git worktree add "$WORKTREE_PATH" "$BRANCH" 2>/dev/null || \
    git worktree add "$WORKTREE_PATH" HEAD 2>/dev/null || {
        echo "ERROR: Could not create worktree"
        exit 1
    }
fi

# ─────────────────────────────────────────────────────────────────────────────
# Write task file
# ─────────────────────────────────────────────────────────────────────────────
cat > "$TASK_FILE" << TASKEOF
# Task for ${AGENT} agent

**Task ID:** ${TASK_ID}
**Timestamp:** $(date -Iseconds)
**Domain:** ${DOMAIN}

## Task Description

${TASK}

## Instructions

1. Work within your domain: ${DOMAIN}
2. Create a feature branch for changes: feat/${AGENT}-{feature-name}
3. Write a summary of what you did to: ${RESULT_FILE}
4. Push your changes when complete

## Result File Format

Write your results in markdown:

\`\`\`markdown
# Result: {brief title}

## Summary
{What you accomplished}

## Changes Made
- {file1}: {description}
- {file2}: {description}

## Branch
{branch name you pushed to}

## Notes
{Any issues or follow-up needed}
\`\`\`
TASKEOF

# ─────────────────────────────────────────────────────────────────────────────
# Display dispatch info
# ─────────────────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════"
echo "DISPATCHING TO: $AGENT"
echo "TASK: $TASK"
echo "WORKTREE: $WORKTREE_PATH"
echo "DOMAIN: $DOMAIN"
echo "═══════════════════════════════════════════════════════════"

# ─────────────────────────────────────────────────────────────────────────────
# Build agent prompt
# ─────────────────────────────────────────────────────────────────────────────
PROMPT="You are the ${AGENT} agent working autonomously in a git worktree.

═══════════════════════════════════════════════════════════
TASK: ${TASK}
═══════════════════════════════════════════════════════════

YOUR DOMAIN (files you should work with):
${DOMAIN}

RULES:
1. Focus on files within your domain
2. Create a feature branch: feat/${AGENT}-{descriptive-name}
3. Make atomic, well-tested changes
4. Write a summary to: ${RESULT_FILE}
5. Push your branch when complete: git push origin HEAD:refs/heads/{branch}

WORKFLOW:
1. Understand the task
2. Explore relevant code in your domain
3. Create feature branch
4. Implement changes
5. Test if possible
6. Write result summary
7. Commit and push

BEGIN WORKING IMMEDIATELY. Do not ask for clarification - make reasonable assumptions and document them in your result file."

# ─────────────────────────────────────────────────────────────────────────────
# Launch agent
# ─────────────────────────────────────────────────────────────────────────────
cd "$WORKTREE_PATH"

# Sync with main repo
git fetch origin 2>/dev/null || true
git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || true

# Run Claude agent
timeout "${TIMEOUT}s" claude --print --output-format json \
    --max-turns "$MAX_TURNS" \
    --allowedTools "Bash,Read,Write,Edit,Glob,Grep,WebFetch,TodoWrite" \
    "$PROMPT" > "$OUTPUT_FILE" 2>&1

EXIT_CODE=$?

# ─────────────────────────────────────────────────────────────────────────────
# Report result
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
if [ $EXIT_CODE -eq 0 ]; then
    echo "✓ ${AGENT} COMPLETED SUCCESSFULLY"
elif [ $EXIT_CODE -eq 124 ]; then
    echo "✗ ${AGENT} TIMED OUT after ${TIMEOUT}s"
else
    echo "✗ ${AGENT} FAILED (exit code: $EXIT_CODE)"
fi
echo "Check: $RESULT_FILE"
echo "═══════════════════════════════════════════════════════════"

exit $EXIT_CODE
EOF

chmod +x .claude/skills/team-coord/scripts/dispatch.sh

# Create SKILL.md
echo -e "${GREEN}[3/5]${NC} Creating skill definition..."
cat > .claude/skills/team-coord/SKILL.md << 'EOF'
---
name: team-coord
description: Dispatch tasks to autonomous agents in git worktrees
triggers:
  - dispatch
  - delegate
  - agent
---

# Team Coordination

Dispatch tasks to specialized Claude agents, each running in isolated git worktrees.

## Quick Usage

```bash
.claude/skills/team-coord/scripts/dispatch.sh <agent> "task"
```

## Examples

```bash
# Single agent
.claude/skills/team-coord/scripts/dispatch.sh api "Add REST endpoint for users"

# Parallel agents (separate terminals or background)
.claude/skills/team-coord/scripts/dispatch.sh api "Create API" &
.claude/skills/team-coord/scripts/dispatch.sh frontend "Create UI" &
wait
```

## Configuration

Edit `dispatch.sh` to customize AGENT_DOMAINS for your project structure.

## Results

Check `.agent-mail/results/{agent}/` for:
- `{timestamp}-result.md` - Agent's summary
- `{timestamp}-output.json` - Full execution log
EOF

# Create settings template
echo -e "${GREEN}[4/5]${NC} Creating settings..."
cat > .claude/settings.local.json << SETTINGS
{
  "permissions": {
    "allow": [
      "Bash(git:*)",
      "Bash(npm:*)",
      "Bash(npx:*)",
      "Bash(pnpm:*)",
      "Bash(yarn:*)",
      "Bash(.claude/skills/team-coord/scripts/dispatch.sh:*)",
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep"
    ],
    "deny": []
  }
}
SETTINGS

# Setup worktrees
echo -e "${GREEN}[5/5]${NC} Creating agent worktrees..."
for agent in "${AGENTS[@]}"; do
    WORKTREE="${WORKTREE_BASE}/${REPO_NAME}-${agent}"
    if [ ! -d "$WORKTREE" ]; then
        echo "  Creating: ${REPO_NAME}-${agent}"
        git worktree add -b "${agent}-workspace" "$WORKTREE" HEAD 2>/dev/null || \
        git worktree add "$WORKTREE" HEAD 2>/dev/null || true
    else
        echo "  Exists: ${REPO_NAME}-${agent}"
    fi
    mkdir -p ".agent-mail/inbox/${agent}"
    mkdir -p ".agent-mail/results/${agent}"
done

# Update gitignore
if ! grep -q "agent-mail/results" .gitignore 2>/dev/null; then
    echo "" >> .gitignore
    echo "# Claude Multi-Agent System" >> .gitignore
    echo ".agent-mail/results/" >> .gitignore
    echo ".claude/settings.local.json" >> .gitignore
fi

# Done
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Installation Complete!                       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Worktrees created:"
for agent in "${AGENTS[@]}"; do
    echo "  ${WORKTREE_BASE}/${REPO_NAME}-${agent}"
done
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit agent domains in dispatch.sh for your project"
echo "     vim .claude/skills/team-coord/scripts/dispatch.sh"
echo ""
echo "  2. Test with a simple task:"
echo "     .claude/skills/team-coord/scripts/dispatch.sh ${AGENTS[0]} \"List files in your domain\""
echo ""
echo "  3. Run agents in parallel:"
echo "     for agent in ${AGENTS[*]}; do"
echo "       .claude/skills/team-coord/scripts/dispatch.sh \$agent \"Your task\" &"
echo "     done"
echo "     wait"
echo ""
