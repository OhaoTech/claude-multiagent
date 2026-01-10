---
name: team-coord
description: Coordinate with Fluxa team agents. Use when changes affect other teams or before editing shared files.
---

# Team Coordination

## Architecture

```
Leader (fluxa/) ─────────────────────────────────────────────
       │
       ├── dispatch.sh api ──► fluxa-api/ (worktree)
       ├── dispatch.sh mobile ──► fluxa-mobile/ (worktree)
       ├── dispatch.sh admin ──► fluxa-admin/ (worktree)
       ├── dispatch.sh pipeline ──► fluxa-pipeline/ (worktree)
       └── dispatch.sh services ──► fluxa-services/ (worktree)
```

## Teams & Worktrees

| Agent | Worktree | Domain |
|-------|----------|--------|
| api | fluxa-api/ | apps/api/ |
| mobile | fluxa-mobile/ | apps/mobile/ |
| admin | fluxa-admin/ | apps/admin/ |
| pipeline | fluxa-pipeline/ | scripts/content-pipeline/ |
| services | fluxa-services/ | services/ |

## Commands

```bash
# Dispatch task to agent (runs in agent's worktree)
.claude/skills/team-coord/scripts/dispatch.sh <agent> "<task>"

# Check orchestration state
.claude/skills/team-coord/scripts/status.sh

# Collect results from agent(s)
.claude/skills/team-coord/scripts/collect.sh [agent|all]
```

## Example Workflow

```bash
# 1. Dispatch to API agent
.claude/skills/team-coord/scripts/dispatch.sh api "Add rate limiting to auth endpoints"

# 2. Wait for completion (timeout 5min, max 10 turns)

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
