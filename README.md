# Claude Code Multi-Agent System

Run multiple autonomous Claude Code agents in parallel, each in their own git worktree. Includes a web IDE for project management and chat.

## Structure

```
claude-multiagent/
├── services/
│   └── agent-monitor/     # Web IDE backend + frontend
│       ├── main.py        # FastAPI server
│       ├── web/           # React frontend
│       └── static/        # Built frontend assets
├── skills/
│   ├── team-coord/        # Team coordination skill
│   │   ├── SKILL.md
│   │   └── scripts/
│   │       ├── dispatch.sh
│   │       ├── collect.sh
│   │       └── status.sh
│   └── agent-monitor/     # Agent monitor skill
└── install.sh             # Installer script
```

## Quick Start

### 1. Install Dependencies

```bash
cd services/agent-monitor
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cd web
npm install
npm run build
```

### 2. Run the Web IDE

```bash
cd services/agent-monitor
python main.py
```

Open http://localhost:8000 in your browser.

### 3. Create a Project

1. Click "New Project"
2. Browse and select a git repository folder
3. The project will be created with a "leader" agent

### 4. Add Agents

1. Go to Monitor view
2. Click "Add Agent"
3. Select a module folder (e.g., `apps/api`)
4. A git worktree will be created for the agent

## Team Coordination

Copy the team-coord skill to your project:

```bash
cp -r skills/team-coord /path/to/your/project/.claude/skills/
```

Then use dispatch commands:

```bash
# Dispatch task to agent
.claude/skills/team-coord/scripts/dispatch.sh api "Add authentication"

# Check status
.claude/skills/team-coord/scripts/status.sh

# Collect results
.claude/skills/team-coord/scripts/collect.sh api
```

## How It Works

```
Leader (main repo) ─────────────────────────────────────
       │
       ├── dispatch.sh api ──► project-api/ (worktree)
       ├── dispatch.sh web ──► project-web/ (worktree)
       └── dispatch.sh mobile ──► project-mobile/ (worktree)
```

- Each agent runs in an isolated git worktree
- Agents read their `AGENTS.md` for context
- Results are reported back to the leader

## Requirements

- Python 3.10+
- Node.js 18+
- Git
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

## License

MIT
