---
name: team-coord
description: Coordinate with Fluxa team agents. Use when changes affect other teams or before editing shared files.
---

# Team Coordination

Dispatch tasks to agent worktrees and collect results.

## Architecture

```
Leader (project/) ─────────────────────────────────────────────
       │
       ├── dispatch.sh agent1 ──► project-agent1/ (worktree)
       ├── dispatch.sh agent2 ──► project-agent2/ (worktree)
       └── dispatch.sh agent3 ──► project-agent3/ (worktree)
```

## Configuration

Create `.claude/agents.yaml` in your project:

```yaml
agents:
  api:
    worktree: myproject-api     # Directory name in parent folder
    domain: apps/api            # Focus area within the project

  mobile:
    worktree: myproject-mobile
    domain: apps/mobile

  services:
    worktree: myproject-services
    domain: services
```

## Setting Up Worktrees

```bash
# From your project root, create worktrees for each agent
git worktree add --detach ../myproject-api HEAD
git worktree add --detach ../myproject-mobile HEAD
git worktree add --detach ../myproject-services HEAD
```

## Commands

```bash
# Dispatch task to agent (runs in agent's worktree)
.claude/skills/team-coord/scripts/dispatch.sh <agent> "<task>"

# Check orchestration state
.claude/skills/team-coord/scripts/status.sh

# Collect results from agent(s)
.claude/skills/team-coord/scripts/collect.sh [agent|all]
```

## Integration with Workflow

When the `workflow` skill is installed, dispatch automatically:
- Injects team context (what other agents are doing)
- Updates agent status in team-state.yaml
- Tracks working/done/blocked states

## Example Workflow

```bash
# 1. Dispatch to API agent
.claude/skills/team-coord/scripts/dispatch.sh api "Add rate limiting to auth endpoints"

# 2. Wait for completion (timeout 30min, max 30 turns)

# 3. Read results
.claude/skills/team-coord/scripts/collect.sh api

# 4. If API says "mobile needs to handle 429", dispatch to mobile
.claude/skills/team-coord/scripts/dispatch.sh mobile "Handle 429 rate limit responses"
```

## Agent Rules (When Dispatched)

If you are an agent receiving a task:
1. Read your AGENTS.md for context (`cat <domain>/AGENTS.md`)
2. Complete the task in your domain
3. Write results to the specified results file
4. Do NOT dispatch other agents - only leader can dispatch
5. Note any follow-up needs in your results under "needs:"
6. Update your status if workflow skill is available

## Result Format

```markdown
---
agent: <agent>
status: success|failed|needs-help
needs: [list of agents if help needed]
timestamp: <timestamp>
---

## Summary
<what you did>

## Files Changed
<list>

## Notes for Leader
<follow-up needs>
```

## Context
Read AGENTS.md files for team responsibilities and current state.
