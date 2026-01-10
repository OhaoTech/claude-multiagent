#!/bin/bash
# Usage: set-mode.sh <mode>
# Sets the work mode
# Modes: scheduled | burst | throttled

set -e

MODE=$1

if [ -z "$MODE" ]; then
    echo "Usage: set-mode.sh <mode>"
    echo "  Modes:"
    echo "    scheduled - 8h/day simulation, natural pace (default)"
    echo "    burst     - Max parallelism, no delays"
    echo "    throttled - Rate-limited, conservative"
    exit 1
fi

# Validate mode
case $MODE in
    scheduled|burst|throttled) ;;
    *) echo "Invalid mode: $MODE (use: scheduled, burst, throttled)"; exit 1 ;;
esac

REPO_ROOT=$(git rev-parse --show-toplevel)
STATE_FILE="$REPO_ROOT/.claude/team-state.yaml"

# Create default state if not exists
if [ ! -f "$STATE_FILE" ]; then
    "$REPO_ROOT/.claude/skills/workflow/scripts/init-state.sh"
fi

python3 << EOF
import yaml
from pathlib import Path

state_file = Path("$STATE_FILE")
state = yaml.safe_load(state_file.read_text()) if state_file.exists() else {}

old_mode = state.get('mode', 'none')
state['mode'] = '$MODE'

state_file.write_text(yaml.dump(state, default_flow_style=False, sort_keys=False))
print(f"Mode changed: {old_mode} -> $MODE")
EOF

# Mode-specific info
case $MODE in
    scheduled)
        echo "Mode: SCHEDULED"
        echo "  - Agents work at sustainable pace"
        echo "  - Natural delays between tasks"
        echo "  - Simulates 8h workday"
        ;;
    burst)
        echo "Mode: BURST"
        echo "  - Maximum parallelism"
        echo "  - All agents work simultaneously"
        echo "  - Use for urgent deadlines"
        ;;
    throttled)
        echo "Mode: THROTTLED"
        echo "  - Rate-limited operations"
        echo "  - Conservative token usage"
        echo "  - Use when approaching limits"
        ;;
esac
