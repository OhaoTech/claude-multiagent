#!/bin/bash
# Shows current orchestration state

REPO_ROOT=$(git rev-parse --show-toplevel)
STATE_FILE="$REPO_ROOT/.agent-mail/state.json"

if [ -f "$STATE_FILE" ]; then
    echo "═══════════════════════════════════════════════════════════"
    echo "ORCHESTRATION STATE"
    echo "═══════════════════════════════════════════════════════════"
    cat "$STATE_FILE" | python3 -m json.tool 2>/dev/null || cat "$STATE_FILE"
    echo ""

    # Show recent results
    echo "═══════════════════════════════════════════════════════════"
    echo "RECENT RESULTS (last 5)"
    echo "═══════════════════════════════════════════════════════════"
    find "$REPO_ROOT/.agent-mail/results" -name "*-result.md" -type f 2>/dev/null | \
        sort -r | head -5 | while read f; do
            echo "  $(basename $(dirname $f)): $(basename $f)"
        done
    echo ""
else
    echo '{"current": null, "status": "idle"}'
fi
