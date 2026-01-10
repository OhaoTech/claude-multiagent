#!/bin/bash
# Stop the Agent Monitor server

PID_FILE="/tmp/agent-monitor.pid"

if [ ! -f "$PID_FILE" ]; then
    echo "Agent Monitor is not running (no PID file)"
    exit 0
fi

PID=$(cat "$PID_FILE")

if kill -0 "$PID" 2>/dev/null; then
    echo "Stopping Agent Monitor (PID: $PID)..."
    kill "$PID"

    # Wait for graceful shutdown
    for i in {1..10}; do
        if ! kill -0 "$PID" 2>/dev/null; then
            break
        fi
        sleep 0.5
    done

    # Force kill if still running
    if kill -0 "$PID" 2>/dev/null; then
        echo "Force killing..."
        kill -9 "$PID" 2>/dev/null
    fi

    rm -f "$PID_FILE"
    echo "Agent Monitor stopped"
else
    echo "Agent Monitor is not running (stale PID file)"
    rm -f "$PID_FILE"
fi
