#!/bin/bash
# Usage: update-status.sh <agent> <status> [task] [blockers]
# Updates agent status in team-state.yaml
# status: idle | working | blocked | done

set -e

AGENT=$1
STATUS=$2
TASK="${3:-}"
BLOCKERS="${4:-}"

if [ -z "$AGENT" ] || [ -z "$STATUS" ]; then
    echo "Usage: update-status.sh <agent> <status> [task] [blockers]"
    echo "  status: idle | working | blocked | done"
    exit 1
fi

# Validate status
case $STATUS in
    idle|working|blocked|done) ;;
    *) echo "Invalid status: $STATUS (use: idle, working, blocked, done)"; exit 1 ;;
esac

REPO_ROOT=$(git rev-parse --show-toplevel)
STATE_FILE="$REPO_ROOT/.claude/team-state.yaml"

# Create default state if not exists
if [ ! -f "$STATE_FILE" ]; then
    "$REPO_ROOT/.claude/skills/workflow/scripts/init-state.sh"
fi

TIMESTAMP=$(date -Iseconds)

# Use python to update YAML (more reliable than yq)
python3 << EOF
import yaml
from pathlib import Path

state_file = Path("$STATE_FILE")
state = yaml.safe_load(state_file.read_text()) if state_file.exists() else {}

if 'agents' not in state:
    state['agents'] = {}

state['agents']['$AGENT'] = {
    'status': '$STATUS',
    'task': '$TASK' if '$TASK' else None,
    'last_update': '$TIMESTAMP',
    'blockers': ['$BLOCKERS'] if '$BLOCKERS' else []
}

state_file.write_text(yaml.dump(state, default_flow_style=False, sort_keys=False))
print(f"Updated $AGENT: $STATUS" + (f" - $TASK" if '$TASK' else ""))
EOF
