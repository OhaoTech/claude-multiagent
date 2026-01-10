#!/bin/bash
# Outputs formatted team context for injection into agent prompts
# Designed to be compact and actionable (< 500 tokens)

REPO_ROOT=$(git rev-parse --show-toplevel)
STATE_FILE="$REPO_ROOT/.claude/team-state.yaml"

if [ ! -f "$STATE_FILE" ]; then
    echo "No team state found. Run: .claude/skills/workflow/scripts/init-state.sh"
    exit 0
fi

python3 << EOF
import yaml
from pathlib import Path
from datetime import datetime

state_file = Path("$STATE_FILE")
state = yaml.safe_load(state_file.read_text())

# Header
print("=" * 50)
print("TEAM STATUS")
print("=" * 50)
print(f"Stage: {state.get('stage', 'unknown')} | Mode: {state.get('mode', 'unknown')}")
print()

# Sprint info
sprint = state.get('sprint', {})
if sprint:
    print(f"Sprint: {sprint.get('name', 'unnamed')}")
    goals = sprint.get('goals', [])
    if goals:
        print("Goals:")
        for g in goals[:3]:  # Limit to 3 goals for brevity
            print(f"  - {g}")
    print()

# Agent status - compact format
agents = state.get('agents', {})
if agents:
    print("Agents:")
    for name, info in agents.items():
        status = info.get('status', 'unknown')
        task = info.get('task', '')
        blockers = info.get('blockers', [])

        # Status emoji
        emoji = {'idle': '.', 'working': '*', 'blocked': '!', 'done': '+'}
        icon = emoji.get(status, '?')

        line = f"  [{icon}] {name}: {status}"
        if task:
            line += f" - {task[:40]}{'...' if len(task) > 40 else ''}"
        print(line)

        if blockers:
            for b in blockers:
                if b:
                    print(f"      ^ blocked: {b}")
    print()

# Global blockers
blockers = state.get('blockers', [])
if blockers:
    print("Team Blockers:")
    for b in blockers:
        print(f"  ! {b}")
    print()

print("=" * 50)
EOF
