#!/bin/bash
# View Agent Monitor logs

LOG_FILE="/tmp/agent-monitor.log"
LINES="${1:-50}"

if [ ! -f "$LOG_FILE" ]; then
    echo "No log file found at $LOG_FILE"
    exit 1
fi

if [ "$1" = "-f" ] || [ "$1" = "--follow" ]; then
    echo "Following logs (Ctrl+C to stop)..."
    tail -f "$LOG_FILE"
else
    echo "Last $LINES lines of $LOG_FILE:"
    echo "───────────────────────────────────────────────────────────"
    tail -n "$LINES" "$LOG_FILE"
    echo "───────────────────────────────────────────────────────────"
    echo "Use: $0 -f  to follow logs in real-time"
fi
