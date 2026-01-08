# Claude Code Multi-Agent System

A lightweight framework for running multiple autonomous Claude Code agents in parallel, each isolated in their own git worktree.

## Features

- **Agent Isolation**: Each agent works in a separate git worktree (no conflicts)
- **Autonomous Execution**: Agents run independently for up to 30 turns
- **Domain Boundaries**: Restrict agents to specific directories
- **Simple Dispatch**: One command to launch any agent
- **Result Tracking**: All outputs saved to `.agent-mail/results/`

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/OhaoTech/claude-multiagent/main/install.sh | bash -s -- . api frontend backend
```

Or clone and run:

```bash
git clone https://github.com/OhaoTech/claude-multiagent.git
cd claude-multiagent
./install.sh /path/to/your/repo agent1 agent2 agent3
```

## Usage

After installation, dispatch tasks to agents:

```bash
# Basic dispatch
.claude/skills/team-coord/scripts/dispatch.sh api "Add user authentication endpoint"

# Multiple agents in parallel (run in separate terminals)
.claude/skills/team-coord/scripts/dispatch.sh frontend "Create login page" &
.claude/skills/team-coord/scripts/dispatch.sh api "Create auth API" &
wait
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                     Main Repository                          │
│                                                              │
│  .claude/skills/team-coord/scripts/dispatch.sh              │
│                         │                                    │
│         ┌───────────────┼───────────────┐                   │
│         ▼               ▼               ▼                   │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐               │
│   │ Worktree │   │ Worktree │   │ Worktree │               │
│   │  (api)   │   │(frontend)│   │(backend) │               │
│   │          │   │          │   │          │               │
│   │ Claude   │   │ Claude   │   │ Claude   │               │
│   │ Agent    │   │ Agent    │   │ Agent    │               │
│   └────┬─────┘   └────┬─────┘   └────┬─────┘               │
│        │              │              │                      │
│        └──────────────┴──────────────┘                      │
│                       │                                      │
│                       ▼                                      │
│            .agent-mail/results/                              │
│            feat/* branches pushed                            │
└─────────────────────────────────────────────────────────────┘
```

1. **Dispatch** calls `dispatch.sh` with agent name and task
2. **Worktree** is created/reused for isolation (e.g., `repo-api/`)
3. **Agent** runs Claude Code autonomously in the worktree
4. **Results** written to `.agent-mail/results/{agent}/`
5. **Changes** pushed to feature branches

## Configuration

Edit `dispatch.sh` to define your agents and their domains:

```bash
declare -A AGENT_DOMAINS=(
    ["api"]="src/api/ src/models/"
    ["frontend"]="src/components/ src/pages/"
    ["backend"]="services/ scripts/"
    ["mobile"]="apps/mobile/"
    ["devops"]="infrastructure/ .github/"
)
```

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MAX_TURNS` | 30 | Max conversation turns per agent |
| `TIMEOUT` | 1800 | Timeout in seconds (30 min) |

## Directory Structure

After installation:

```
your-repo/
├── .claude/
│   ├── skills/
│   │   └── team-coord/
│   │       ├── SKILL.md
│   │       └── scripts/
│   │           └── dispatch.sh
│   └── settings.local.json
├── .agent-mail/
│   ├── inbox/{agent}/      # Task files
│   └── results/{agent}/    # Output files
└── ...

../your-repo-api/           # API agent worktree
../your-repo-frontend/      # Frontend agent worktree
../your-repo-backend/       # Backend agent worktree
```

## Requirements

- Git repository
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed
- Bash shell

## Example: Full-Stack Feature

```bash
# Leader dispatches to all agents
.claude/skills/team-coord/scripts/dispatch.sh api "Create /users CRUD endpoints with Prisma" &
.claude/skills/team-coord/scripts/dispatch.sh frontend "Create user management dashboard at /admin/users" &
.claude/skills/team-coord/scripts/dispatch.sh backend "Add user sync job to process user updates" &
wait

# Check results
cat .agent-mail/results/api/*-result.md
cat .agent-mail/results/frontend/*-result.md
cat .agent-mail/results/backend/*-result.md

# Merge feature branches
git merge feat/api-users feat/frontend-users feat/backend-users
```

## Tips

1. **Start Small**: Test with one agent before running multiple in parallel
2. **Clear Domains**: Non-overlapping domains prevent merge conflicts
3. **Check Results**: Always review `.agent-mail/results/` before merging
4. **Feature Branches**: Agents push to `feat/{agent}-*` branches

## License

MIT

## Contributing

PRs welcome! Please open an issue first to discuss major changes.
