#!/bin/bash
# Initializes a default team-state.yaml

REPO_ROOT=$(git rev-parse --show-toplevel)
STATE_FILE="$REPO_ROOT/.claude/team-state.yaml"

if [ -f "$STATE_FILE" ]; then
    echo "Team state already exists: $STATE_FILE"
    echo "Delete it first if you want to reinitialize."
    exit 1
fi

mkdir -p "$(dirname "$STATE_FILE")"

# Get project name from directory
PROJECT_NAME=$(basename "$REPO_ROOT")

cat > "$STATE_FILE" << EOF
version: 1
project: $PROJECT_NAME
stage: init
mode: scheduled

# Sprint/iteration info
sprint:
  name: "Sprint 1"
  started: null
  goals: []

# Agent status - populated as agents report in
agents:
  leader:
    status: idle
    task: null
    last_update: null
    blockers: []

# Global blockers affecting the team
blockers: []

# Stage transitions log
transitions: []
EOF

echo "Created: $STATE_FILE"
echo "Next steps:"
echo "  1. Edit sprint goals in $STATE_FILE"
echo "  2. Transition to plan: .claude/skills/workflow/scripts/transition.sh plan"
