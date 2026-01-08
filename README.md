# Claude Code Multi-Agent System

Run multiple autonomous Claude Code agents in parallel, each in their own git worktree.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/OhaoTech/claude-multiagent/main/install.sh | bash
```

Or:

```bash
git clone https://github.com/OhaoTech/claude-multiagent.git
./claude-multiagent/install.sh /path/to/your/repo
```

## Usage

```bash
# Dispatch a task to an agent
.claude/skills/team-coord/scripts/dispatch.sh api "Add user authentication"

# Run multiple agents in parallel
.claude/skills/team-coord/scripts/dispatch.sh api "Create REST endpoints" &
.claude/skills/team-coord/scripts/dispatch.sh frontend "Build UI components" &
wait

# Check results
cat .agent-mail/results/api/*-result.md
```

## How It Works

```
Your Repo (leader) ─────────────────────────────────
       │
       ├── dispatch.sh api ──► repo-api/ (worktree)
       ├── dispatch.sh frontend ──► repo-frontend/ (worktree)
       └── dispatch.sh backend ──► repo-backend/ (worktree)
```

1. **Worktree isolation** - Each agent works in a separate git worktree (no conflicts)
2. **Autonomous execution** - Agents run for up to 30 turns / 30 minutes
3. **Results tracking** - Output saved to `.agent-mail/results/{agent}/`
4. **Feature branches** - Agents push changes to their own branches

## Configuration

After install, edit the case statement in `dispatch.sh` to define your agents:

```bash
case $AGENT in
    api)      WORK_DIR="$LAB_DIR/${REPO_NAME}-api"      ; DOMAIN="src/api" ;;
    frontend) WORK_DIR="$LAB_DIR/${REPO_NAME}-frontend" ; DOMAIN="src/frontend" ;;
    backend)  WORK_DIR="$LAB_DIR/${REPO_NAME}-backend"  ; DOMAIN="src/backend" ;;
    mobile)   WORK_DIR="$LAB_DIR/${REPO_NAME}-mobile"   ; DOMAIN="apps/mobile" ;;
esac
```

## Requirements

- Git repository
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed
- Bash

## License

MIT
