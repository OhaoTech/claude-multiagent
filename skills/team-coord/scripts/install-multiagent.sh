#!/bin/bash
#
# Install Fluxa Multi-Agent System to another repository
#
# Usage:
#   ./install-multiagent.sh /path/to/target/repo
#   ./install-multiagent.sh /path/to/repo agent1 agent2 agent3
#
# This sets up:
#   - dispatch.sh for launching autonomous agents
#   - Git worktrees for agent isolation
#   - Agent mailbox system for results
#   - Claude Code skill configuration

set -e

TARGET_REPO="${1:-.}"
shift
AGENTS=("$@")

# Default agents if none specified
if [ ${#AGENTS[@]} -eq 0 ]; then
    AGENTS=("api" "frontend" "backend")
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_REPO="$(dirname "$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")")"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║       Multi-Agent System Installer                       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Source: $SOURCE_REPO"
echo "Target: $TARGET_REPO"
echo "Agents: ${AGENTS[*]}"
echo ""

# Validate target is a git repo
if [ ! -d "$TARGET_REPO/.git" ]; then
    echo "ERROR: Target must be a git repository"
    echo "Run: cd $TARGET_REPO && git init"
    exit 1
fi

cd "$TARGET_REPO"
TARGET_REPO="$(pwd)"
REPO_NAME="$(basename "$TARGET_REPO")"

echo "Step 1: Creating directory structure..."
mkdir -p .claude/skills/team-coord/scripts
mkdir -p .agent-mail/inbox
mkdir -p .agent-mail/results

# Create dispatch.sh
echo "Step 2: Installing dispatch.sh..."
cat > .claude/skills/team-coord/scripts/dispatch.sh << 'DISPATCH_SCRIPT'
#!/bin/bash
# Multi-Agent Dispatcher - Launches autonomous Claude agents in worktrees
# Usage: dispatch.sh <agent-name> "task description"

set -e

AGENT="$1"
TASK="$2"
MAX_TURNS="${3:-30}"
TIMEOUT="${4:-1800}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")")"
REPO_NAME="$(basename "$REPO_ROOT")"

# Agent config - customize per project
declare -A AGENT_DOMAINS=(
    ["api"]="apps/api/ packages/shared/"
    ["frontend"]="apps/web/ apps/admin/"
    ["backend"]="services/ scripts/"
    ["mobile"]="apps/mobile/"
    ["pipeline"]="scripts/content-pipeline/"
)

WORKTREE_BASE="$(dirname "$REPO_ROOT")"
WORKTREE_PATH="${WORKTREE_BASE}/${REPO_NAME}-${AGENT}"

if [ -z "$AGENT" ] || [ -z "$TASK" ]; then
    echo "Usage: dispatch.sh <agent> \"task\""
    echo "Agents: ${!AGENT_DOMAINS[*]}"
    exit 1
fi

DOMAIN="${AGENT_DOMAINS[$AGENT]:-}"
INBOX_DIR="${REPO_ROOT}/.agent-mail/inbox/${AGENT}"
RESULTS_DIR="${REPO_ROOT}/.agent-mail/results/${AGENT}"
mkdir -p "$INBOX_DIR" "$RESULTS_DIR"

TASK_ID="$(date +%s)"
TASK_FILE="${INBOX_DIR}/${TASK_ID}-task.md"
RESULT_FILE="${RESULTS_DIR}/${TASK_ID}-result.md"
OUTPUT_FILE="${RESULTS_DIR}/${TASK_ID}-output.json"

# Create worktree if needed
if [ ! -d "$WORKTREE_PATH" ]; then
    echo "Creating worktree: $WORKTREE_PATH"
    BRANCH="${AGENT}-workspace"
    cd "$REPO_ROOT"
    git worktree add -b "$BRANCH" "$WORKTREE_PATH" HEAD 2>/dev/null || \
    git worktree add "$WORKTREE_PATH" "$BRANCH" 2>/dev/null || \
    git worktree add "$WORKTREE_PATH" HEAD
fi

# Write task file
cat > "$TASK_FILE" << EOF
# Task for ${AGENT} agent
**ID:** ${TASK_ID}
**Domain:** ${DOMAIN:-"(full repo)"}

## Task
${TASK}

## Instructions
1. Work within your domain: ${DOMAIN:-"any files"}
2. Write results to: ${RESULT_FILE}
3. Create feature branches for changes
4. Push when complete
EOF

echo "═══════════════════════════════════════════════════════════"
echo "DISPATCHING TO: $AGENT"
echo "TASK: $TASK"
echo "WORKTREE: $WORKTREE_PATH"
echo "DOMAIN: ${DOMAIN:-"(full repo)"}"
echo "═══════════════════════════════════════════════════════════"

# Build prompt
PROMPT="You are the ${AGENT} agent. Work in this worktree.

TASK: ${TASK}

DOMAIN: ${DOMAIN:-"Full repository access"}

RULES:
1. Stay within your domain files
2. Create feature branch: feat/${AGENT}-{feature}
3. Write summary to: ${RESULT_FILE}
4. Push changes when done

BEGIN IMMEDIATELY."

# Launch agent
cd "$WORKTREE_PATH"
timeout "${TIMEOUT}s" claude --print --output-format json \
    --max-turns "$MAX_TURNS" \
    --allowedTools "Bash,Read,Write,Edit,Glob,Grep,WebFetch" \
    "$PROMPT" > "$OUTPUT_FILE" 2>&1

EXIT_CODE=$?

echo "═══════════════════════════════════════════════════════════"
if [ $EXIT_CODE -eq 0 ]; then
    echo "✓ $AGENT COMPLETED"
else
    echo "✗ $AGENT FAILED (exit code: $EXIT_CODE)"
fi
echo "Check: $RESULT_FILE"
echo "═══════════════════════════════════════════════════════════"

exit $EXIT_CODE
DISPATCH_SCRIPT

chmod +x .claude/skills/team-coord/scripts/dispatch.sh

# Create SKILL.md
echo "Step 3: Creating skill definition..."
cat > .claude/skills/team-coord/SKILL.md << 'SKILL_MD'
---
name: team-coord
triggers:
  - dispatch
  - agent
  - delegate
---

# Team Coordination Skill

Dispatch tasks to specialized agents running in isolated git worktrees.

## Usage

```bash
.claude/skills/team-coord/scripts/dispatch.sh <agent> "task description"
```

## Available Agents

Configure agents in dispatch.sh AGENT_DOMAINS array.

## How It Works

1. Each agent runs in a separate git worktree (isolated branch)
2. Agents work autonomously for up to 30 turns
3. Results written to .agent-mail/results/{agent}/
4. Changes pushed to feature branches

## Example

```bash
# Dispatch API work
.claude/skills/team-coord/scripts/dispatch.sh api "Add user authentication endpoint"

# Dispatch frontend work
.claude/skills/team-coord/scripts/dispatch.sh frontend "Create login form component"
```
SKILL_MD

# Create settings template
echo "Step 4: Creating settings template..."
cat > .claude/settings.local.json.template << SETTINGS_TEMPLATE
{
  "permissions": {
    "allow": [
      "Bash(git:*)",
      "Bash(npm:*)",
      "Bash(npx:*)",
      "Bash(.claude/skills/team-coord/scripts/dispatch.sh:*)",
      "Read",
      "Write",
      "Edit"
    ],
    "deny": []
  }
}
SETTINGS_TEMPLATE

# Setup agent worktrees
echo "Step 5: Setting up agent worktrees..."
for agent in "${AGENTS[@]}"; do
    WORKTREE="${WORKTREE_BASE}/${REPO_NAME}-${agent}"
    if [ ! -d "$WORKTREE" ]; then
        echo "  Creating worktree: ${REPO_NAME}-${agent}"
        git worktree add -b "${agent}-workspace" "$WORKTREE" HEAD 2>/dev/null || \
        git worktree add "$WORKTREE" HEAD 2>/dev/null || true
    else
        echo "  Worktree exists: ${REPO_NAME}-${agent}"
    fi
    mkdir -p ".agent-mail/inbox/${agent}"
    mkdir -p ".agent-mail/results/${agent}"
done

# Add to gitignore
echo "Step 6: Updating .gitignore..."
if ! grep -q ".agent-mail/results" .gitignore 2>/dev/null; then
    echo "" >> .gitignore
    echo "# Multi-agent system" >> .gitignore
    echo ".agent-mail/results/" >> .gitignore
    echo ".claude/settings.local.json" >> .gitignore
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║       Installation Complete!                             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "1. Copy settings template:"
echo "   cp .claude/settings.local.json.template .claude/settings.local.json"
echo ""
echo "2. Edit dispatch.sh AGENT_DOMAINS for your project structure"
echo ""
echo "3. Test dispatch:"
echo "   .claude/skills/team-coord/scripts/dispatch.sh ${AGENTS[0]} \"Hello, confirm you can access the repo\""
echo ""
echo "Worktrees created:"
for agent in "${AGENTS[@]}"; do
    echo "  - ${WORKTREE_BASE}/${REPO_NAME}-${agent}"
done
echo ""
