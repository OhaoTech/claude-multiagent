---
name: agent-monitor
description: Start, stop, and manage the Agent Monitor web interface for viewing sessions and chatting with agents over LAN.
---

# Agent Monitor

Web interface for monitoring and chatting with Claude Code agents, accessible from any device on LAN.

## Architecture

```
┌─────────────────┐     HTTP/WS      ┌──────────────────┐
│   Phone/Web     │◄───────────────►│  Agent Monitor   │
│   (LAN access)  │   :8888         │  FastAPI Server  │
└─────────────────┘                  └────────┬─────────┘
                                              │
              ┌───────────────────────────────┼───────────────────────────────┐
              │                               │                               │
              ▼                               ▼                               ▼
    ┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
    │ Session Reader   │         │ Process Manager  │         │ File Watcher     │
    │ ~/.claude/       │         │ spawn claude -p  │         │ .agent-mail/     │
    │ projects/        │         │ stream output    │         │ state + results  │
    └──────────────────┘         └──────────────────┘         └──────────────────┘
```

## Commands

```bash
# Start the agent monitor server
.claude/skills/agent-monitor/scripts/start.sh

# Stop the server
.claude/skills/agent-monitor/scripts/stop.sh

# Check status
.claude/skills/agent-monitor/scripts/status.sh

# View logs
.claude/skills/agent-monitor/scripts/logs.sh
```

## Web UI

Once running, access from any device on LAN:

| URL | Description |
|-----|-------------|
| `http://<host>:8888/` | Dashboard - all agents |
| `http://<host>:8888/agent/<name>` | Sessions for agent |
| `http://<host>:8888/chat/<session_id>` | Chat view |
| `http://<host>:8888/chat?agent=<name>` | New chat |

## Features

### Dashboard
- See all 6 agents (leader, api, mobile, admin, pipeline, services)
- Real-time status indicators
- Click agent to view their sessions

### Session History
- View all Claude Code sessions per agent
- See message count, cost, timestamps
- Click to open full conversation

### Interactive Chat
- Send messages to agents from phone/web
- Stream responses in real-time
- 4 modes: Normal, Plan, Auto Edit, YOLO
- Permission prompts forwarded to UI

## Integration with team-coord

The agent monitor watches `.agent-mail/` for:
- `state.json` - Current orchestration state
- `results/<agent>/` - Agent result files
- `commands/` - Pending commands

When team-coord dispatches tasks, the monitor shows:
1. Which agent is currently working
2. Task being executed
3. Results when complete

## Configuration

Environment variables:
```bash
REPO_ROOT=/home/frankyin/Desktop/lab/fluxa  # Project root
PORT=8888                                    # Server port
```

## Files

```
services/agent-monitor/
├── main.py              # FastAPI server
├── sessions.py          # Session reader
├── claude_runner.py     # Claude process manager
├── watcher.py           # File system watcher
├── models.py            # Data models
├── static/
│   ├── index.html       # Dashboard
│   ├── sessions.html    # Session list
│   ├── chat.html        # Chat interface
│   ├── chat.css         # Chat styles
│   └── chat.js          # Chat logic
└── requirements.txt
```

## Quick Start

```bash
# 1. Start the monitor
.claude/skills/agent-monitor/scripts/start.sh

# 2. Get your LAN IP
hostname -I | awk '{print $1}'

# 3. Open on phone: http://<ip>:8888

# 4. To stop
.claude/skills/agent-monitor/scripts/stop.sh
```
