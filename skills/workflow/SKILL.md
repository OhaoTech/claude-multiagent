---
name: workflow
description: Manage team workflow stages, shared state, and work modes. Foundation for agent coordination.
---

# Workflow Management

Team workflow system for coordinating agents through project lifecycle stages.

## Architecture

```
                     ┌─────────────────────────────────────────┐
                     │         team-state.yaml                 │
                     │  - stage: plan/work/review              │
                     │  - mode: scheduled/burst/throttled      │
                     │  - agents: {status, task, blockers}     │
                     └────────────────┬────────────────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
        ▼                             ▼                             ▼
  ┌───────────┐               ┌───────────────┐              ┌─────────────┐
  │ update    │               │ team-context  │              │ transition  │
  │ status    │               │ (inject)      │              │ stage       │
  └───────────┘               └───────────────┘              └─────────────┘
       │                             │                             │
       ▼                             ▼                             ▼
  Agent updates              Before dispatch,              Leader moves
  their status               inject team state             workflow forward
```

## Workflow Stages

| Stage | Description | Who Leads |
|-------|-------------|-----------|
| `init` | Team formation, setup worktrees | Leader |
| `plan` | Sprint planning, task breakdown | Leader |
| `work` | Execution phase, agents working | All agents |
| `review` | Check-in, sync, merge results | Leader |

## Work Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `scheduled` | 8h/day simulation, natural pace | Default, sustainable |
| `burst` | Max parallelism, no delays | Urgent deadlines |
| `throttled` | Rate-limited, conservative | Cost control |

## Commands

```bash
# Update agent status (agents call this)
.claude/skills/workflow/scripts/update-status.sh <agent> <status> [task] [blockers]
# status: idle | working | blocked | done

# Get team context (for injection into prompts)
.claude/skills/workflow/scripts/team-context.sh

# Transition to next stage
.claude/skills/workflow/scripts/transition.sh <stage>

# Set work mode
.claude/skills/workflow/scripts/set-mode.sh <mode>

# View current state
.claude/skills/workflow/scripts/state.sh
```

## Team State File

Location: `.claude/team-state.yaml`

```yaml
version: 1
project: myproject
stage: work
mode: scheduled

# Sprint/iteration info
sprint:
  name: "v0.1 launch prep"
  started: 2025-01-10
  goals:
    - "Complete auth flow"
    - "Fix mobile performance"

# Agent status
agents:
  leader:
    status: idle
    task: null
    last_update: 2025-01-10T10:00:00
  api:
    status: working
    task: "Add rate limiting to auth endpoints"
    last_update: 2025-01-10T10:15:00
    blockers: []
  mobile:
    status: blocked
    task: "Handle 429 responses"
    last_update: 2025-01-10T10:10:00
    blockers:
      - "Waiting for api to finish rate limiting"
  admin:
    status: idle
    task: null
    last_update: 2025-01-10T09:30:00

# Shared notes/blockers
blockers:
  - "TTS service rate limited until tomorrow"
```

## Integration with team-coord

The `dispatch.sh` script should call `team-context.sh` to inject awareness:

```bash
# In dispatch.sh, add to system prompt:
TEAM_CONTEXT=$(.claude/skills/workflow/scripts/team-context.sh)

# Inject into agent prompt:
SYSTEM_PROMPT="...
TEAM AWARENESS:
$TEAM_CONTEXT
..."
```

## Agent Protocol

When receiving a task, agents should:

1. Update status to `working`:
   ```bash
   .claude/skills/workflow/scripts/update-status.sh $AGENT working "$TASK"
   ```

2. If blocked, update with blocker:
   ```bash
   .claude/skills/workflow/scripts/update-status.sh $AGENT blocked "$TASK" "Waiting for api"
   ```

3. When done:
   ```bash
   .claude/skills/workflow/scripts/update-status.sh $AGENT done "$TASK"
   ```

## Example Workflow

```bash
# 1. Initialize state
.claude/skills/workflow/scripts/init-state.sh

# 2. Start sprint (leader)
.claude/skills/workflow/scripts/transition.sh plan
# Edit team-state.yaml sprint goals

# 3. Enter work phase
.claude/skills/workflow/scripts/transition.sh work

# 4. Dispatch with context (team-coord now injects automatically)
.claude/skills/team-coord/scripts/dispatch.sh api "Add rate limiting"

# 5. Check team status
.claude/skills/workflow/scripts/state.sh

# 6. Review phase
.claude/skills/workflow/scripts/transition.sh review
.claude/skills/team-coord/scripts/collect.sh all
```

## Token Efficiency

The `team-context.sh` output is designed to be:
- Compact (< 500 tokens typically)
- Actionable (focus on blockers/dependencies)
- Time-aware (highlight stale updates)

Agents only get context relevant to their work, reducing unnecessary token usage.
