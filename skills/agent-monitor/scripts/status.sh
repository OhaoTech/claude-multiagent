#!/bin/bash
# Check Agent Monitor status

PID_FILE="/tmp/agent-monitor.pid"
LOG_FILE="/tmp/agent-monitor.log"
PORT="${PORT:-8888}"

echo "═══════════════════════════════════════════════════════════"
echo "Agent Monitor Status"
echo "═══════════════════════════════════════════════════════════"

# Check PID file
if [ ! -f "$PID_FILE" ]; then
    echo "Status:   NOT RUNNING"
    echo "═══════════════════════════════════════════════════════════"
    exit 1
fi

PID=$(cat "$PID_FILE")

if kill -0 "$PID" 2>/dev/null; then
    LAN_IP=$(hostname -I | awk '{print $1}')

    # Try to get health info
    HEALTH=$(curl -s "http://localhost:$PORT/api/health" 2>/dev/null || echo '{"error": "unreachable"}')
    CONNECTIONS=$(echo "$HEALTH" | jq -r '.connections // "?"')

    echo "Status:   RUNNING"
    echo "PID:      $PID"
    echo "Port:     $PORT"
    echo "Local:    http://localhost:$PORT"
    echo "LAN:      http://$LAN_IP:$PORT"
    echo "Clients:  $CONNECTIONS"
    echo "Log:      $LOG_FILE"
    echo "───────────────────────────────────────────────────────────"
    echo "Recent log:"
    tail -5 "$LOG_FILE" 2>/dev/null || echo "(no logs)"
else
    echo "Status:   NOT RUNNING (stale PID)"
    rm -f "$PID_FILE"
fi

echo "═══════════════════════════════════════════════════════════"
