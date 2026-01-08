#!/bin/bash
#
# Claude Code Multi-Agent System Installer
#
# Usage:
#   ./install.sh /path/to/repo
#   ./install.sh .
#
# Creates the dispatch system and worktrees for autonomous agents.

set -e

TARGET_REPO="${1:-.}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Claude Code Multi-Agent System                       ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Resolve path
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
    echo -e "${RED}ERROR: Not a git repository${NC}"
    exit 1
fi

cd "$TARGET_REPO"
REPO_NAME="$(basename "$TARGET_REPO")"
LAB_DIR="$(dirname "$TARGET_REPO")"

echo "Repository: $TARGET_REPO"
echo ""

# Create structure
echo -e "${GREEN}[1/3]${NC} Creating directory structure..."
mkdir -p .claude/skills/team-coord/scripts
mkdir -p .agent-mail/results

# Create dispatch.sh
echo -e "${GREEN}[2/3]${NC} Installing dispatch.sh..."
cat > .claude/skills/team-coord/scripts/dispatch.sh << 'DISPATCHEOF'
#!/bin/bash
# Usage: dispatch.sh <agent> "<task>"
# Dispatches a task to an agent headlessly in their worktree

set -e

AGENT=$1
TASK=$2

if [ -z "$AGENT" ] || [ -z "$TASK" ]; then
    echo "Usage: dispatch.sh <agent> \"<task>\""
    echo ""
    echo "Configure agents in this file (edit the case statement below)"
    exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
LAB_DIR=$(dirname "$REPO_ROOT")
REPO_NAME=$(basename "$REPO_ROOT")

# ═══════════════════════════════════════════════════════════════════════════
# CONFIGURE YOUR AGENTS HERE
# Map agent name to: worktree directory and domain (files they work with)
# ═══════════════════════════════════════════════════════════════════════════
case $AGENT in
    api)      WORK_DIR="$LAB_DIR/${REPO_NAME}-api"      ; DOMAIN="src/api" ;;
    frontend) WORK_DIR="$LAB_DIR/${REPO_NAME}-frontend" ; DOMAIN="src/frontend" ;;
    backend)  WORK_DIR="$LAB_DIR/${REPO_NAME}-backend"  ; DOMAIN="src/backend" ;;
    # Add more agents as needed:
    # mobile)   WORK_DIR="$LAB_DIR/${REPO_NAME}-mobile"   ; DOMAIN="apps/mobile" ;;
    # pipeline) WORK_DIR="$LAB_DIR/${REPO_NAME}-pipeline" ; DOMAIN="scripts/" ;;
    *)
        echo "Unknown agent: $AGENT"
        echo "Edit dispatch.sh to add this agent"
        exit 1
        ;;
esac

# Create worktree if it doesn't exist
if [ ! -d "$WORK_DIR" ]; then
    echo "Creating worktree: $WORK_DIR"
    git worktree add --detach "$WORK_DIR" HEAD
fi

RESULTS_DIR="$REPO_ROOT/.agent-mail/results/$AGENT"
TIMESTAMP=$(date +%s)
mkdir -p "$RESULTS_DIR"

# Build prompt for agent
read -r -d '' SYSTEM_PROMPT << EOF || true
You are the $AGENT agent.
Worktree: $WORK_DIR (your isolated working directory)
Focus domain: $DOMAIN/

TASK FROM LEADER:
$TASK

RULES:
1. Complete the task autonomously
2. Focus on files in your domain: $DOMAIN/
3. When done, write results to: $RESULTS_DIR/$TIMESTAMP-result.md
4. Create feature branches for your changes
5. Push when complete

RESULT FILE FORMAT (write to $RESULTS_DIR/$TIMESTAMP-result.md):
---
agent: $AGENT
status: success|failed|needs-help
timestamp: $TIMESTAMP
---

## Summary
<what you did>

## Files Changed
<list of files modified>

## Branch
<branch name you pushed>

## Notes
<anything important>
EOF

echo "═══════════════════════════════════════════════════════════"
echo "DISPATCHING TO: $AGENT"
echo "TASK: $TASK"
echo "WORKTREE: $WORK_DIR"
echo "DOMAIN: $DOMAIN/"
echo "═══════════════════════════════════════════════════════════"

# Run agent in their worktree
cd "$WORK_DIR"

if timeout 1800 claude -p "$SYSTEM_PROMPT" \
    --max-turns 30 \
    --output-format json \
    > "$RESULTS_DIR/$TIMESTAMP-output.json" 2>&1; then
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "✓ $AGENT COMPLETED"
    echo "Results: $RESULTS_DIR/$TIMESTAMP-result.md"
    echo "═══════════════════════════════════════════════════════════"
else
    EXIT_CODE=$?
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "✗ $AGENT FAILED (exit code: $EXIT_CODE)"
    echo "Check: $RESULTS_DIR/$TIMESTAMP-output.json"
    echo "═══════════════════════════════════════════════════════════"
    exit $EXIT_CODE
fi
DISPATCHEOF

chmod +x .claude/skills/team-coord/scripts/dispatch.sh

# Create SKILL.md
echo -e "${GREEN}[3/3]${NC} Creating skill docs..."
cat > .claude/skills/team-coord/SKILL.md << 'EOF'
---
name: team-coord
description: Dispatch tasks to autonomous agents in git worktrees
---

# Team Coordination

## Usage

```bash
.claude/skills/team-coord/scripts/dispatch.sh <agent> "<task>"
```

## How It Works

```
Leader (main repo) ─────────────────────────────────
       │
       ├── dispatch.sh api ──► repo-api/ (worktree)
       ├── dispatch.sh frontend ──► repo-frontend/ (worktree)
       └── dispatch.sh backend ──► repo-backend/ (worktree)
```

1. Each agent runs in an isolated git worktree
2. Agents work autonomously (30 turns max, 30 min timeout)
3. Results written to `.agent-mail/results/{agent}/`
4. Changes pushed to feature branches

## Configure Agents

Edit `dispatch.sh` case statement to define your agents:

```bash
case $AGENT in
    api)      WORK_DIR="..." ; DOMAIN="src/api" ;;
    frontend) WORK_DIR="..." ; DOMAIN="src/frontend" ;;
    # add more...
esac
```

## Example

```bash
# Dispatch API work
.claude/skills/team-coord/scripts/dispatch.sh api "Add user auth endpoint"

# Check results
cat .agent-mail/results/api/*-result.md
```
EOF

# Gitignore
if ! grep -q "agent-mail/results" .gitignore 2>/dev/null; then
    echo "" >> .gitignore
    echo "# Multi-agent system" >> .gitignore
    echo ".agent-mail/results/" >> .gitignore
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Installation Complete!                       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit dispatch.sh to configure your agents:"
echo "     vim .claude/skills/team-coord/scripts/dispatch.sh"
echo ""
echo "  2. Test:"
echo "     .claude/skills/team-coord/scripts/dispatch.sh api \"Hello, list files\""
echo ""
