#!/bin/bash
# Shows current workflow state in a formatted view

REPO_ROOT=$(git rev-parse --show-toplevel)
STATE_FILE="$REPO_ROOT/.claude/team-state.yaml"

if [ ! -f "$STATE_FILE" ]; then
    echo "No team state found."
    echo "Initialize with: .claude/skills/workflow/scripts/init-state.sh"
    exit 0
fi

# Use the team-context script for display
"$REPO_ROOT/.claude/skills/workflow/scripts/team-context.sh"

# Also show recent transitions
python3 << EOF
import yaml
from pathlib import Path

state_file = Path("$STATE_FILE")
state = yaml.safe_load(state_file.read_text())

transitions = state.get('transitions', [])
if transitions:
    print("Recent Transitions:")
    for t in transitions[-5:]:
        print(f"  {t.get('from', '?')} -> {t.get('to', '?')} at {t.get('at', '?')[:19]}")
    print()
EOF
