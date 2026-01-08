#!/bin/bash
#
# Claude Code Multi-Agent System Installer
#
# Usage:
#   ./install.sh /path/to/repo
#   ./install.sh .

set -e

TARGET_REPO="${1:-.}"

# Colors
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
    TARGET_REPO="$(cd "$TARGET_REPO" 2>/dev/null && pwd)"
fi

cd "$TARGET_REPO"
REPO_NAME="$(basename "$TARGET_REPO")"

echo "Repository: $TARGET_REPO"
echo ""

# Create structure
echo -e "${GREEN}[1/4]${NC} Creating directories..."
mkdir -p .claude/skills/team-coord/scripts
mkdir -p .agent-mail/results

# Create agents.conf (user configures this)
echo -e "${GREEN}[2/4]${NC} Creating agents.conf..."
cat > .claude/agents.conf << 'EOF'
# Agent Configuration
# Format: AGENT_NAME:DOMAIN_PATH
#
# Example:
#   api:src/api
#   frontend:src/components
#   backend:services
#
# Worktrees will be created as: ../reponame-agentname/
# Edit this file to add/remove agents

api:src/api
frontend:src/frontend
backend:src/backend
EOF

# Create dispatch.sh (reads from agents.conf)
echo -e "${GREEN}[3/4]${NC} Installing dispatch.sh..."
cat > .claude/skills/team-coord/scripts/dispatch.sh << 'EOF'
#!/bin/bash
# Usage: dispatch.sh <agent> "<task>"

set -e

AGENT=$1
TASK=$2

REPO_ROOT=$(git rev-parse --show-toplevel)
CONFIG_FILE="$REPO_ROOT/.claude/agents.conf"

# Show available agents if no args
if [ -z "$AGENT" ] || [ -z "$TASK" ]; then
    echo "Usage: dispatch.sh <agent> \"<task>\""
    echo ""
    echo "Available agents (from .claude/agents.conf):"
    grep -v "^#" "$CONFIG_FILE" | grep -v "^$" | while read line; do
        name=$(echo "$line" | cut -d: -f1)
        domain=$(echo "$line" | cut -d: -f2)
        echo "  $name -> $domain/"
    done
    exit 1
fi

# Read agent config
DOMAIN=$(grep "^${AGENT}:" "$CONFIG_FILE" | cut -d: -f2)

if [ -z "$DOMAIN" ]; then
    echo "Unknown agent: $AGENT"
    echo "Add it to .claude/agents.conf"
    exit 1
fi

LAB_DIR=$(dirname "$REPO_ROOT")
REPO_NAME=$(basename "$REPO_ROOT")
WORK_DIR="$LAB_DIR/${REPO_NAME}-${AGENT}"

# Create worktree if needed
if [ ! -d "$WORK_DIR" ]; then
    echo "Creating worktree: $WORK_DIR"
    git worktree add --detach "$WORK_DIR" HEAD
fi

RESULTS_DIR="$REPO_ROOT/.agent-mail/results/$AGENT"
TIMESTAMP=$(date +%s)
mkdir -p "$RESULTS_DIR"

# Build prompt
read -r -d '' PROMPT << PROMPTEOF || true
You are the $AGENT agent.
Worktree: $WORK_DIR
Domain: $DOMAIN/

TASK: $TASK

RULES:
1. Focus on files in: $DOMAIN/
2. Write results to: $RESULTS_DIR/$TIMESTAMP-result.md
3. Create feature branch, push when done

RESULT FORMAT:
---
agent: $AGENT
status: success|failed
---
## Summary
<what you did>
## Files Changed
<list>
## Branch
<branch pushed>
PROMPTEOF

echo "═══════════════════════════════════════════════════════════"
echo "DISPATCHING TO: $AGENT"
echo "TASK: $TASK"
echo "WORKTREE: $WORK_DIR"
echo "DOMAIN: $DOMAIN/"
echo "═══════════════════════════════════════════════════════════"

cd "$WORK_DIR"

if timeout 1800 claude -p "$PROMPT" \
    --max-turns 30 \
    --output-format json \
    > "$RESULTS_DIR/$TIMESTAMP-output.json" 2>&1; then
    echo "═══════════════════════════════════════════════════════════"
    echo "✓ $AGENT COMPLETED"
    echo "Results: $RESULTS_DIR/$TIMESTAMP-result.md"
    echo "═══════════════════════════════════════════════════════════"
else
    EXIT_CODE=$?
    echo "═══════════════════════════════════════════════════════════"
    echo "✗ $AGENT FAILED (exit code: $EXIT_CODE)"
    echo "Check: $RESULTS_DIR/$TIMESTAMP-output.json"
    echo "═══════════════════════════════════════════════════════════"
    exit $EXIT_CODE
fi
EOF

chmod +x .claude/skills/team-coord/scripts/dispatch.sh

# Create SKILL.md
echo -e "${GREEN}[4/4]${NC} Creating docs..."
cat > .claude/skills/team-coord/SKILL.md << 'EOF'
---
name: team-coord
description: Dispatch tasks to autonomous agents
---

# Team Coordination

## Usage

```bash
.claude/skills/team-coord/scripts/dispatch.sh <agent> "<task>"
```

## Configure Agents

Edit `.claude/agents.conf`:

```
api:src/api
frontend:src/components
backend:services
mobile:apps/mobile
```

## Example

```bash
.claude/skills/team-coord/scripts/dispatch.sh api "Add auth endpoint"
```
EOF

# Gitignore
grep -q "agent-mail/results" .gitignore 2>/dev/null || echo ".agent-mail/results/" >> .gitignore

echo ""
echo -e "${GREEN}Done!${NC}"
echo ""
echo "Configure your agents:"
echo "  vim .claude/agents.conf"
echo ""
echo "Then dispatch:"
echo "  .claude/skills/team-coord/scripts/dispatch.sh api \"Your task\""
echo ""
