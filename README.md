# Claude Code Multi-Agent System

Run multiple autonomous Claude Code agents in parallel, each in their own git worktree.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/OhaoTech/claude-multiagent/main/install.sh | bash
```

## Configure Agents

Edit `.claude/agents.conf`:

```
# Format: name:domain
api:src/api
frontend:src/components
backend:services
mobile:apps/mobile
```

## Usage

```bash
# Dispatch task
.claude/skills/team-coord/scripts/dispatch.sh api "Add user authentication"

# Parallel agents
.claude/skills/team-coord/scripts/dispatch.sh api "Create endpoints" &
.claude/skills/team-coord/scripts/dispatch.sh frontend "Build UI" &
wait

# Check results
cat .agent-mail/results/api/*-result.md
```

## How It Works

```
Your Repo ──────────────────────────────────────────
    │
    ├── .claude/agents.conf      # Agent definitions
    │
    └── dispatch.sh ─┬─► repo-api/       (worktree)
                     ├─► repo-frontend/  (worktree)
                     └─► repo-backend/   (worktree)
```

- Each agent runs in isolated git worktree
- 30 turns max, 30 min timeout
- Results in `.agent-mail/results/{agent}/`

## Requirements

- Git repo
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

## License

MIT
