#!/bin/bash
# Start the Agent Monitor server

set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
MONITOR_DIR="$REPO_ROOT/services/agent-monitor"
PID_FILE="/tmp/agent-monitor.pid"
LOG_FILE="/tmp/agent-monitor.log"

# Check if already running
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Agent Monitor already running (PID: $PID)"
        echo "URL: http://$(hostname -I | awk '{print $1}'):8888"
        exit 0
    else
        rm -f "$PID_FILE"
    fi
fi

# Check requirements
if [ ! -f "$MONITOR_DIR/main.py" ]; then
    echo "ERROR: Agent Monitor not found at $MONITOR_DIR"
    exit 1
fi

# Check for virtual environment or install deps
if [ ! -d "$MONITOR_DIR/.venv" ]; then
    echo "Setting up virtual environment..."
    python3 -m venv "$MONITOR_DIR/.venv"
    source "$MONITOR_DIR/.venv/bin/activate"
    pip install -q -r "$MONITOR_DIR/requirements.txt"
else
    source "$MONITOR_DIR/.venv/bin/activate"
fi

# Export environment
export REPO_ROOT="$REPO_ROOT"
export PORT="${PORT:-8888}"

# Start server in background
cd "$MONITOR_DIR"
nohup python main.py > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

# Wait for startup
sleep 2

# Check if started successfully
if kill -0 $(cat "$PID_FILE") 2>/dev/null; then
    LAN_IP=$(hostname -I | awk '{print $1}')
    echo "═══════════════════════════════════════════════════════════"
    echo "Agent Monitor Started"
    echo "═══════════════════════════════════════════════════════════"
    echo "PID:      $(cat $PID_FILE)"
    echo "Local:    http://localhost:$PORT"
    echo "LAN:      http://$LAN_IP:$PORT"
    echo "Log:      $LOG_FILE"
    echo "═══════════════════════════════════════════════════════════"
else
    echo "ERROR: Failed to start Agent Monitor"
    echo "Check logs: $LOG_FILE"
    cat "$LOG_FILE"
    exit 1
fi
