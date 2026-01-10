#!/bin/bash
# Collects results from agents
# Usage: collect.sh [agent]    - show latest result from agent
#        collect.sh all        - show latest from all agents
#        collect.sh            - same as 'all'

REPO_ROOT=$(git rev-parse --show-toplevel)
RESULTS_DIR="$REPO_ROOT/.agent-mail/results"
AGENT=${1:-all}

show_agent_results() {
    local agent=$1
    local agent_dir="$RESULTS_DIR/$agent"

    if [ -d "$agent_dir" ]; then
        # Get latest result file
        latest=$(ls -t "$agent_dir"/*-result.md 2>/dev/null | head -1)
        if [ -n "$latest" ] && [ -f "$latest" ]; then
            echo "═══════════════════════════════════════════════════════════"
            echo "[$agent] $(basename $latest)"
            echo "═══════════════════════════════════════════════════════════"
            cat "$latest"
            echo ""
        else
            echo "[$agent] No results yet"
        fi
    else
        echo "[$agent] No results directory"
    fi
}

if [ "$AGENT" = "all" ]; then
    for a in api mobile admin pipeline services; do
        show_agent_results $a
    done
else
    show_agent_results $AGENT
fi
