#!/bin/bash
# Usage: transition.sh <stage>
# Transitions workflow to a new stage
# Stages: init | plan | work | review

set -e

STAGE=$1

if [ -z "$STAGE" ]; then
    echo "Usage: transition.sh <stage>"
    echo "  Stages: init, plan, work, review"
    exit 1
fi

# Validate stage
case $STAGE in
    init|plan|work|review) ;;
    *) echo "Invalid stage: $STAGE (use: init, plan, work, review)"; exit 1 ;;
esac

REPO_ROOT=$(git rev-parse --show-toplevel)
STATE_FILE="$REPO_ROOT/.claude/team-state.yaml"

# Create default state if not exists
if [ ! -f "$STATE_FILE" ]; then
    "$REPO_ROOT/.claude/skills/workflow/scripts/init-state.sh"
fi

TIMESTAMP=$(date -Iseconds)

python3 << EOF
import yaml
from pathlib import Path

state_file = Path("$STATE_FILE")
state = yaml.safe_load(state_file.read_text()) if state_file.exists() else {}

old_stage = state.get('stage', 'none')
state['stage'] = '$STAGE'
state['stage_changed'] = '$TIMESTAMP'

# Log transition
if 'transitions' not in state:
    state['transitions'] = []
state['transitions'].append({
    'from': old_stage,
    'to': '$STAGE',
    'at': '$TIMESTAMP'
})
# Keep only last 10 transitions
state['transitions'] = state['transitions'][-10:]

state_file.write_text(yaml.dump(state, default_flow_style=False, sort_keys=False))
print(f"Transitioned: {old_stage} -> $STAGE")
EOF

# Stage-specific actions
case $STAGE in
    init)
        echo "Stage: INIT - Team formation"
        echo "  - Set up worktrees for each agent"
        echo "  - Configure agent domains in team-state.yaml"
        ;;
    plan)
        echo "Stage: PLAN - Sprint planning"
        echo "  - Define sprint goals in team-state.yaml"
        echo "  - Break down tasks and assign to agents"
        ;;
    work)
        echo "Stage: WORK - Execution"
        echo "  - Dispatch tasks with: .claude/skills/team-coord/scripts/dispatch.sh"
        echo "  - Monitor with: .claude/skills/workflow/scripts/state.sh"
        ;;
    review)
        echo "Stage: REVIEW - Check-in"
        echo "  - Collect results: .claude/skills/team-coord/scripts/collect.sh all"
        echo "  - Check blockers and sync"
        ;;
esac
