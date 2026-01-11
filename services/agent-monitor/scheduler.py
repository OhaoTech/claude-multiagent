"""Task queue scheduler service.

Schedules tasks to idle agents based on priority and dependencies.
Respects work modes from team-state.yaml.
Integrates with rate limit monitoring for sustainable autonomous operation.
"""

import asyncio
import json
import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

import frontmatter
import yaml

import database as db
from services.rate_limiter import RateLimitMonitor


class TaskScheduler:
    """Schedules tasks to idle agents based on priority and dependencies."""

    def __init__(
        self,
        project_id: str,
        project_root: Path,
        broadcast_callback: Optional[Callable] = None,
        interval: float = 5.0
    ):
        self.project_id = project_id
        self.project_root = project_root
        self.broadcast = broadcast_callback
        self.interval = interval
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._last_run: Optional[str] = None
        self._running_tasks: dict[str, asyncio.Task] = {}  # task_id -> subprocess task

        # Rate limit monitoring
        self._rate_monitor = RateLimitMonitor()
        self._paused_for_rate_limit = False
        self._rate_limit_reason: Optional[str] = None

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def last_run(self) -> Optional[str]:
        return self._last_run

    @property
    def is_paused_for_rate_limit(self) -> bool:
        return self._paused_for_rate_limit

    @property
    def rate_limit_reason(self) -> Optional[str]:
        return self._rate_limit_reason

    def get_rate_limit_status(self) -> dict:
        """Get current rate limit status."""
        usage = self._rate_monitor.get_usage_percentage()
        should_pause, pause_reason = self._rate_monitor.should_pause()
        should_throttle, throttle_reason = self._rate_monitor.should_throttle()

        return {
            "usage": usage,
            "should_pause": should_pause,
            "pause_reason": pause_reason if should_pause else None,
            "should_throttle": should_throttle,
            "throttle_reason": throttle_reason if should_throttle else None,
            "is_paused": self._paused_for_rate_limit,
            "paused_reason": self._rate_limit_reason,
        }

    async def start(self):
        """Start the scheduler loop."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._scheduler_loop())
        print(f"[SCHEDULER] Started for project {self.project_id}")

    async def stop(self):
        """Stop the scheduler."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

        # Cancel all running dispatch tasks
        for task_id, proc_task in list(self._running_tasks.items()):
            proc_task.cancel()
            try:
                await proc_task
            except asyncio.CancelledError:
                pass

        self._running_tasks.clear()
        print("[SCHEDULER] Stopped")

    async def _scheduler_loop(self):
        """Main scheduler loop."""
        while self._running:
            try:
                await self._process_queue()
                self._last_run = datetime.utcnow().isoformat()
            except Exception as e:
                print(f"[SCHEDULER] Error: {e}")
            await asyncio.sleep(self._get_dispatch_delay())

    async def _process_queue(self):
        """Process pending tasks and assign to idle agents."""
        # 0. Check rate limits first
        should_pause, pause_reason = self._rate_monitor.should_pause()
        if should_pause:
            if not self._paused_for_rate_limit:
                self._paused_for_rate_limit = True
                self._rate_limit_reason = pause_reason
                print(f"[SCHEDULER] Paused for rate limit: {pause_reason}")
                if self.broadcast:
                    await self.broadcast({
                        "type": "scheduler_paused",
                        "data": {
                            "reason": "rate_limit",
                            "message": pause_reason,
                            "usage": self._rate_monitor.get_usage_percentage()
                        }
                    })
            return

        # Resume if we were paused but limits are ok now
        if self._paused_for_rate_limit:
            self._paused_for_rate_limit = False
            self._rate_limit_reason = None
            print("[SCHEDULER] Resumed after rate limit cooldown")
            if self.broadcast:
                await self.broadcast({
                    "type": "scheduler_resumed",
                    "data": {"reason": "rate_limit_cleared"}
                })

        # 1. Update blocked tasks (check if dependencies completed)
        self._update_blocked_tasks()

        # 2. Get idle agents
        idle_agents = self._get_idle_agents()
        if not idle_agents:
            return

        # 3. Get pending tasks
        pending_tasks = db.list_tasks(
            self.project_id,
            status="pending",
            order_by="priority DESC, created_at ASC"
        )

        if not pending_tasks:
            return

        # 4. Check if we should throttle (approaching limits)
        should_throttle, throttle_reason = self._rate_monitor.should_throttle()
        if should_throttle:
            # In throttle mode, only dispatch one task per cycle
            print(f"[SCHEDULER] Throttling: {throttle_reason}")
            idle_agents = idle_agents[:1]

        # 5. Assign tasks to agents
        for agent in idle_agents:
            if not pending_tasks:
                break

            task = self._find_task_for_agent(pending_tasks, agent)
            if task:
                await self._dispatch_task(task, agent)
                pending_tasks.remove(task)

                # If throttling, stop after one dispatch
                if should_throttle:
                    break

    def _get_team_state(self) -> dict:
        """Read team state from .claude/team-state.yaml."""
        state_file = self.project_root / ".claude" / "team-state.yaml"
        if state_file.exists():
            try:
                return yaml.safe_load(state_file.read_text()) or {}
            except Exception:
                pass
        return {"mode": "scheduled", "agents": {}}

    def _get_work_mode(self) -> str:
        """Get current work mode from team state."""
        state = self._get_team_state()
        return state.get("mode", "scheduled")

    def _get_dispatch_delay(self) -> float:
        """Get delay based on work mode."""
        mode = self._get_work_mode()
        if mode == "burst":
            return 2.0  # Fast but not instant
        elif mode == "throttled":
            return 30.0
        else:  # scheduled
            return self.interval

    def _get_idle_agents(self) -> list[dict]:
        """Get agents that are idle and ready for work."""
        agents = db.list_agents(self.project_id)
        team_state = self._get_team_state()
        agent_states = team_state.get("agents", {})

        idle_agents = []
        for agent in agents:
            # Skip leader - leader dispatches, doesn't receive tasks
            if agent.get("is_leader"):
                continue

            # Check if agent is active
            if agent.get("status") != "active":
                continue

            # Check agent status in team state
            agent_name = agent["name"]
            state = agent_states.get(agent_name, {})
            status = state.get("status", "idle")

            # Only consider idle or done agents
            if status in ("idle", "done"):
                # Also check if agent has any running tasks in our tracker
                if agent["id"] not in [t.get("agent_id") for t in db.list_tasks(
                    self.project_id, status="running"
                )]:
                    idle_agents.append(agent)

        return idle_agents

    def _find_task_for_agent(
        self,
        tasks: list[dict],
        agent: dict
    ) -> Optional[dict]:
        """Find best matching task for an agent."""
        # Priority 1: Tasks explicitly assigned to this agent
        for task in tasks:
            if task.get("agent_id") == agent["id"]:
                return task

        # Priority 2: Unassigned tasks
        for task in tasks:
            if not task.get("agent_id"):
                return task

        return None

    def _update_blocked_tasks(self):
        """Check blocked tasks and unblock if dependencies are met."""
        blocked_tasks = db.get_blocked_tasks(self.project_id)

        for task in blocked_tasks:
            depends_on = task.get("depends_on", [])
            if not depends_on:
                db.update_task(task["id"], status="pending")
                continue

            # Check if all dependencies are completed
            all_complete = True
            for dep_id in depends_on:
                dep_task = db.get_task(dep_id)
                if not dep_task or dep_task["status"] != "completed":
                    all_complete = False
                    break

            if all_complete:
                db.update_task(task["id"], status="pending")
                if self.broadcast:
                    asyncio.create_task(self.broadcast({
                        "type": "task_unblocked",
                        "data": {"task_id": task["id"]}
                    }))

    async def _dispatch_task(self, task: dict, agent: dict):
        """Dispatch a task to an agent."""
        now = datetime.utcnow().isoformat()

        # Update task status in DB
        db.update_task(
            task["id"],
            status="running",
            agent_id=agent["id"],
            started_at=now
        )

        # Also update the task dict in memory so _read_agent_result can find it
        task["agent_id"] = agent["id"]
        task["status"] = "running"
        task["started_at"] = now

        # Broadcast task started
        if self.broadcast:
            await self.broadcast({
                "type": "task_started",
                "data": {
                    "task_id": task["id"],
                    "agent_id": agent["id"],
                    "agent_name": agent["name"]
                }
            })

        # Find dispatch script
        dispatch_script = self.project_root / ".claude" / "skills" / "team-coord" / "scripts" / "dispatch.sh"
        if not dispatch_script.exists():
            # Try bundled skills location
            dispatch_script = Path(__file__).parent.parent.parent / "skills" / "team-coord" / "scripts" / "dispatch.sh"

        if not dispatch_script.exists():
            print(f"[SCHEDULER] dispatch.sh not found, marking task as failed")
            await self._handle_task_failure(task, "dispatch.sh not found")
            return

        # Run dispatch in background
        proc_task = asyncio.create_task(
            self._run_dispatch(task, agent, dispatch_script)
        )
        self._running_tasks[task["id"]] = proc_task

    async def _run_dispatch(
        self,
        task: dict,
        agent: dict,
        dispatch_script: Path
    ):
        """Run dispatch.sh and wait for completion."""
        task_description = task.get("description") or task["title"]

        try:
            process = await asyncio.create_subprocess_exec(
                str(dispatch_script),
                agent["name"],
                task_description,
                cwd=str(self.project_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={
                    **dict(__import__("os").environ),
                    "TASK_ID": task["id"],
                }
            )

            stdout, stderr = await process.communicate()

            if process.returncode == 0:
                await self._handle_task_success(task, stdout.decode())
            else:
                error = stderr.decode() or f"Exit code: {process.returncode}"
                await self._handle_task_failure(task, error)

        except asyncio.CancelledError:
            db.update_task(task["id"], status="pending", agent_id=None, started_at=None)
            raise
        except Exception as e:
            await self._handle_task_failure(task, str(e))
        finally:
            self._running_tasks.pop(task["id"], None)

    async def _handle_task_success(self, task: dict, output: str):
        """Handle successful task completion."""
        now = datetime.utcnow().isoformat()

        # Try to read the actual result from .agent-mail/results/
        result = self._read_agent_result(task)

        db.update_task(
            task["id"],
            status="completed",
            completed_at=now,
            result=result
        )

        if self.broadcast:
            await self.broadcast({
                "type": "task_completed",
                "data": {"task_id": task["id"]}
            })

    def _read_agent_result(self, task: dict) -> dict:
        """Read the latest result files for the task's agent."""
        agent_id = task.get("agent_id")
        if not agent_id:
            return {"output": "No agent assigned"}

        # Get agent name from ID
        agent = db.get_agent(agent_id)
        if not agent:
            return {"output": "Agent not found"}

        agent_name = agent["name"]
        results_dir = self.project_root / ".agent-mail" / "results" / agent_name

        if not results_dir.exists():
            return {"output": "No results directory"}

        # Find the latest result files (by timestamp in filename)
        result_files = sorted(results_dir.glob("*-result.md"), reverse=True)
        output_files = sorted(results_dir.glob("*-output.json"), reverse=True)

        result = {}

        # Parse the latest result.md
        if result_files:
            try:
                result_path = result_files[0]
                content = result_path.read_text()
                post = frontmatter.loads(content)

                # Extract metadata
                result["status"] = post.get("status", "unknown")
                result["needs"] = post.get("needs", [])
                result["file"] = result_path.name

                # Extract summary
                if "## Summary" in post.content:
                    match = re.search(r"## Summary\s*\n(.*?)(?=\n##|\Z)", post.content, re.DOTALL)
                    if match:
                        result["summary"] = match.group(1).strip()[:500]

                # Extract files changed
                if "## Files Changed" in post.content:
                    match = re.search(r"## Files Changed\s*\n(.*?)(?=\n##|\Z)", post.content, re.DOTALL)
                    if match:
                        result["files_changed"] = [
                            line.strip().lstrip("- ")
                            for line in match.group(1).strip().split("\n")
                            if line.strip()
                        ][:20]
            except Exception as e:
                result["parse_error"] = str(e)

        # Parse the latest output.json for session_id and cost
        if output_files:
            try:
                output_path = output_files[0]
                data = json.loads(output_path.read_text())
                result["session_id"] = data.get("session_id")
                result["cost_usd"] = data.get("total_cost_usd")
                result["duration_ms"] = data.get("duration_ms")
                result["num_turns"] = data.get("num_turns")
            except Exception as e:
                result["output_parse_error"] = str(e)

        return result if result else {"output": "No result files found"}

    async def _handle_task_failure(self, task: dict, error: str):
        """Handle task failure with retry logic."""
        retry_count = (task.get("retry_count") or 0) + 1
        max_retries = task.get("max_retries", 2)

        if retry_count <= max_retries:
            # Retry: reset to pending
            db.update_task(
                task["id"],
                status="pending",
                retry_count=retry_count,
                agent_id=None,
                started_at=None,
                error=f"Retry {retry_count}/{max_retries}: {error[:200]}"
            )

            if self.broadcast:
                await self.broadcast({
                    "type": "task_retry",
                    "data": {
                        "task_id": task["id"],
                        "retry_count": retry_count,
                        "max_retries": max_retries
                    }
                })
        else:
            # Max retries exceeded: mark as failed
            now = datetime.utcnow().isoformat()
            db.update_task(
                task["id"],
                status="failed",
                completed_at=now,
                error=f"Failed after {max_retries} retries: {error[:200]}"
            )

            if self.broadcast:
                await self.broadcast({
                    "type": "task_failed",
                    "data": {
                        "task_id": task["id"],
                        "error": error[:200]
                    }
                })

    async def cancel_task(self, task_id: str) -> bool:
        """Cancel a running task."""
        if task_id in self._running_tasks:
            self._running_tasks[task_id].cancel()
            try:
                await self._running_tasks[task_id]
            except asyncio.CancelledError:
                pass

            db.update_task(
                task_id,
                status="failed",
                completed_at=datetime.utcnow().isoformat(),
                error="Cancelled by user"
            )
            return True

        return False

    async def retry_task(self, task_id: str) -> bool:
        """Retry a failed task."""
        task = db.get_task(task_id)
        if not task or task["status"] != "failed":
            return False

        db.update_task(
            task_id,
            status="pending",
            retry_count=0,
            agent_id=None,
            started_at=None,
            completed_at=None,
            error=None
        )

        if self.broadcast:
            await self.broadcast({
                "type": "task_retry",
                "data": {"task_id": task_id, "retry_count": 0}
            })

        return True


# Global scheduler instance
_scheduler: Optional[TaskScheduler] = None


def get_scheduler() -> Optional[TaskScheduler]:
    """Get the global scheduler instance."""
    return _scheduler


def set_scheduler(scheduler: Optional[TaskScheduler]):
    """Set the global scheduler instance."""
    global _scheduler
    _scheduler = scheduler
