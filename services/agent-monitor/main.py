"""
Agent Activity Monitor v2 - Interactive chat interface for Claude Code agents.

Provides a web interface to:
- Monitor agent activities in real-time
- View session history and conversation logs
- Chat interactively with agents via Claude Code
"""

import asyncio
import json
import os
import subprocess
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from models import (
    AgentInfo, AgentState, ChatRequest, Command, CommandFile, SessionInfo, SessionMessage,
    ProjectCreate, ProjectUpdate, ProjectResponse,
    AgentCreate, AgentUpdate, AgentResponse,
    SettingsResponse, SettingsUpdate,
    ProjectSettingsResponse, ProjectSettingsUpdate,
    TaskCreate, TaskUpdate, TaskResponse, TaskAssign, QueueStats, SchedulerStatus,
    TaskTemplateCreate, TaskTemplateUpdate, TaskTemplateResponse, CreateFromTemplateRequest,
    SprintCreate, SprintUpdate, SprintResponse, SprintStats,
    UsageAnalytics, ModelUsage, DailyActivity
)
from watcher import AgentMailWatcher, SessionWatcher
from sessions import get_all_sessions, get_sessions_for_agent, get_session_messages
from claude_runner import ClaudeRunner, chat_manager
from scheduler import TaskScheduler, get_scheduler, set_scheduler
import database as db

# Configuration
REPO_ROOT = Path(os.environ.get("REPO_ROOT", "/home/frankyin/Desktop/lab/fluxa"))
AGENT_MAIL_PATH = REPO_ROOT / ".agent-mail"
COMMANDS_PATH = AGENT_MAIL_PATH / "commands"
RESULTS_PATH = AGENT_MAIL_PATH / "results"
PORT = int(os.environ.get("PORT", 8888))

# Skills directory (bundled with agent-monitor)
SKILLS_DIR = Path(__file__).parent.parent.parent / "skills"
DEFAULT_SKILLS = ["team-coord", "workflow", "agent-monitor"]  # Auto-install on project creation

# Note: Agents are now managed in the database, not hardcoded here.
# Use the /api/projects/{id}/sync-worktrees endpoint to import existing git worktrees.


def parse_skill_metadata(skill_path: Path) -> dict:
    """Parse skill metadata from SKILL.md frontmatter."""
    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        return {"name": skill_path.name, "description": ""}

    content = skill_md.read_text()
    metadata = {"name": skill_path.name, "description": ""}

    # Parse YAML frontmatter
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            import re
            frontmatter = parts[1]
            name_match = re.search(r'^name:\s*(.+)$', frontmatter, re.MULTILINE)
            desc_match = re.search(r'^description:\s*(.+)$', frontmatter, re.MULTILINE)
            if name_match:
                metadata["name"] = name_match.group(1).strip()
            if desc_match:
                metadata["description"] = desc_match.group(1).strip()

    return metadata


def get_available_skills() -> list[dict]:
    """Get list of available skills from the bundled skills directory."""
    skills = []
    if not SKILLS_DIR.exists():
        return skills

    for skill_path in sorted(SKILLS_DIR.iterdir()):
        if skill_path.is_dir() and not skill_path.name.startswith('.'):
            metadata = parse_skill_metadata(skill_path)
            skills.append({
                "id": skill_path.name,
                "name": metadata["name"],
                "description": metadata["description"],
                "path": str(skill_path),
            })

    return skills


def get_installed_skills(project_root: Path) -> list[dict]:
    """Get list of installed skills for a project."""
    skills_dir = project_root / ".claude" / "skills"
    if not skills_dir.exists():
        return []

    skills = []
    for skill_path in sorted(skills_dir.iterdir()):
        if skill_path.is_dir() and not skill_path.name.startswith('.'):
            metadata = parse_skill_metadata(skill_path)
            skills.append({
                "id": skill_path.name,
                "name": metadata["name"],
                "description": metadata["description"],
                "path": str(skill_path),
            })

    return skills


def install_skill(project_root: Path, skill_id: str) -> bool:
    """Install a skill to a project by copying from bundled skills."""
    import shutil

    source = SKILLS_DIR / skill_id
    if not source.exists():
        return False

    target = project_root / ".claude" / "skills" / skill_id
    target.parent.mkdir(parents=True, exist_ok=True)

    if target.exists():
        shutil.rmtree(target)

    shutil.copytree(source, target)
    return True


def uninstall_skill(project_root: Path, skill_id: str) -> bool:
    """Uninstall a skill from a project."""
    import shutil

    target = project_root / ".claude" / "skills" / skill_id
    if not target.exists():
        return False

    shutil.rmtree(target)
    return True


class ConnectionManager:
    """Manage WebSocket connections."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        """Send message to all connected clients."""
        message["timestamp"] = time.time()
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass  # Client disconnected


manager = ConnectionManager()
watcher: Optional[AgentMailWatcher] = None
session_watcher: Optional[SessionWatcher] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle."""
    global watcher, session_watcher

    # Ensure directories exist
    COMMANDS_PATH.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.mkdir(parents=True, exist_ok=True)

    # Start file watcher
    loop = asyncio.get_event_loop()
    watcher = AgentMailWatcher(AGENT_MAIL_PATH, manager.broadcast)
    watcher.start(loop)

    # Start session watcher
    session_watcher = SessionWatcher(manager.broadcast)

    # Add Claude session directories to watch
    # Sessions are stored at ~/.claude/projects/{project-path-hash}/
    claude_projects_dir = Path.home() / ".claude" / "projects"
    if claude_projects_dir.exists():
        for project_dir in claude_projects_dir.iterdir():
            if project_dir.is_dir():
                session_watcher.add_path(project_dir)

    session_watcher.start(loop)

    # Initialize scheduler if there's an active project
    active_project = db.get_active_project()
    if active_project:
        scheduler = TaskScheduler(
            project_id=active_project["id"],
            project_root=Path(active_project["root_path"]),
            broadcast_callback=manager.broadcast,
            interval=5.0
        )
        set_scheduler(scheduler)
        # Don't auto-start - user controls via API

    yield

    # Cleanup
    scheduler = get_scheduler()
    if scheduler and scheduler.is_running:
        await scheduler.stop()
    set_scheduler(None)

    if watcher:
        watcher.stop()
    if session_watcher:
        session_watcher.stop()


app = FastAPI(
    title="Agent Activity Monitor",
    description="Real-time monitoring for Claude Code agents",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for LAN access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# API Endpoints

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "agent-monitor",
        "watching": str(AGENT_MAIL_PATH),
        "connections": len(manager.active_connections)
    }


@app.get("/api/state")
async def get_state() -> AgentState:
    """Get current agent orchestration state."""
    state_file = AGENT_MAIL_PATH / "state.json"
    if state_file.exists():
        data = json.loads(state_file.read_text())
        return AgentState(**data)
    return AgentState()


@app.get("/api/agents")
async def get_agents() -> list[AgentInfo]:
    """Get list of all agents with their status from the active project."""
    active_project = db.get_active_project()
    if not active_project:
        return []

    db_agents = db.list_agents(active_project["id"])
    agents = []

    for agent_data in db_agents:
        name = agent_data["name"]
        result_dir = RESULTS_PATH / name
        result_count = 0
        last_result = None

        if result_dir.exists():
            result_files = sorted(result_dir.glob("*-output.json"), reverse=True)
            result_count = len(result_files)

            if result_files:
                try:
                    data = json.loads(result_files[0].read_text())
                    last_result = {
                        "agent": name,
                        "status": "success" if not data.get("is_error") else "failed",
                        "cost_usd": data.get("total_cost_usd"),
                        "duration_ms": data.get("duration_ms"),
                        "timestamp": int(result_files[0].stem.split("-")[0])
                    }
                except Exception:
                    pass

        # Extract worktree folder name from path
        worktree_path = agent_data.get("worktree_path", "")
        worktree = Path(worktree_path).name if worktree_path else name

        agents.append(AgentInfo(
            name=name,
            domain=agent_data["domain"],
            worktree=worktree,
            last_result=last_result,
            result_count=result_count
        ))

    return agents


@app.get("/api/results/{agent}")
async def get_results(agent: str, limit: int = 10):
    """Get recent results for an agent."""
    # Results are stored by agent name, no validation needed

    result_dir = RESULTS_PATH / agent
    if not result_dir.exists():
        return {"results": []}

    results = []
    output_files = sorted(result_dir.glob("*-output.json"), reverse=True)[:limit]

    for output_file in output_files:
        try:
            data = json.loads(output_file.read_text())
            results.append({
                "file": output_file.name,
                "timestamp": int(output_file.stem.split("-")[0]),
                "is_error": data.get("is_error", False),
                "duration_ms": data.get("duration_ms"),
                "num_turns": data.get("num_turns"),
                "cost_usd": data.get("total_cost_usd"),
                "result_preview": data.get("result", "")[:200]
            })
        except Exception:
            pass

    return {"results": results}


@app.post("/api/command")
async def send_command(command: Command):
    """Send a command to an agent."""
    # Commands can be sent to any agent name

    timestamp = int(time.time())
    cmd_id = f"{timestamp}-cmd"

    cmd_file = CommandFile(
        id=cmd_id,
        agent=command.agent,
        content=command.content,
        type=command.type,
        timestamp=timestamp,
        status="pending"
    )

    cmd_path = COMMANDS_PATH / f"{cmd_id}.json"
    cmd_path.write_text(cmd_file.model_dump_json(indent=2))

    # Broadcast command acknowledgment
    await manager.broadcast({
        "type": "command_ack",
        "data": cmd_file.model_dump()
    })

    return {"success": True, "command": cmd_file}


@app.get("/api/commands")
async def get_commands(status: str = "pending"):
    """Get pending commands."""
    commands = []
    for cmd_file in sorted(COMMANDS_PATH.glob("*-cmd.json"), reverse=True)[:50]:
        try:
            data = json.loads(cmd_file.read_text())
            if status == "all" or data.get("status") == status:
                commands.append(data)
        except Exception:
            pass
    return {"commands": commands}


# Session Endpoints

@app.get("/api/sessions")
async def list_all_sessions(limit: int = 50) -> list[SessionInfo]:
    """Get all sessions for the active project."""
    # Get active project and its agents
    active_project = db.get_active_project()
    project_root = None
    agents = None

    if active_project:
        project_root = active_project.get("root_path")
        agents = db.list_agents(active_project["id"])

    sessions = get_all_sessions(project_root, agents)
    return sessions[:limit]


@app.get("/api/sessions/{agent}")
async def list_agent_sessions(agent: str, limit: int = 50) -> list[SessionInfo]:
    """Get sessions for a specific agent within the active project."""
    # Get active project and its agents
    active_project = db.get_active_project()
    project_root = None
    agents = None

    if active_project:
        project_root = active_project.get("root_path")
        agents = db.list_agents(active_project["id"])

    sessions = get_sessions_for_agent(agent, project_root, agents)
    return sessions[:limit]


@app.get("/api/session/{session_id}")
async def get_session(session_id: str):
    """Get full conversation history for a session."""
    messages = get_session_messages(session_id)
    return {
        "session_id": session_id,
        "messages": [m.model_dump() for m in messages],
        "count": len(messages)
    }


# =============================================================================
# Project Endpoints
# =============================================================================

@app.get("/api/projects", response_model=list[ProjectResponse])
async def list_projects():
    """List all projects."""
    projects = db.list_projects()
    return [ProjectResponse(**p) for p in projects]


@app.get("/api/projects/active", response_model=ProjectResponse)
async def get_active_project():
    """Get the currently active project."""
    project = db.get_active_project()
    if not project:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="No active project")
    return ProjectResponse(**project)


@app.post("/api/projects", response_model=ProjectResponse)
async def create_project(request: ProjectCreate):
    """Create a new project with a default leader agent."""
    # Check if path exists
    root_path = Path(request.root_path)
    if not root_path.exists():
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Path does not exist: {request.root_path}")

    # Check if already registered
    existing = db.get_project_by_path(request.root_path)
    if existing:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Project with this path already exists")

    project = db.create_project(request.name, request.root_path, request.description)

    # Auto-install default skills
    project_root = Path(request.root_path)
    for skill_id in DEFAULT_SKILLS:
        try:
            install_skill(project_root, skill_id)
        except Exception as e:
            print(f"Warning: Failed to install skill {skill_id}: {e}")

    return ProjectResponse(**project)


@app.get("/api/projects/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str):
    """Get a project by ID."""
    project = db.get_project(project_id)
    if not project:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectResponse(**project)


@app.put("/api/projects/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, request: ProjectUpdate):
    """Update a project."""
    updates = request.model_dump(exclude_unset=True)
    project = db.update_project(project_id, **updates)
    if not project:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectResponse(**project)


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    """Delete a project and its agents."""
    success = db.delete_project(project_id)
    if not success:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True}


@app.post("/api/projects/{project_id}/select", response_model=ProjectResponse)
async def select_project(project_id: str):
    """Set a project as the active project."""
    project = db.set_active_project(project_id)
    if not project:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Project not found")

    # Update global REPO_ROOT for this session
    global REPO_ROOT, AGENT_MAIL_PATH, COMMANDS_PATH, RESULTS_PATH
    REPO_ROOT = Path(project["root_path"])
    AGENT_MAIL_PATH = REPO_ROOT / ".agent-mail"
    COMMANDS_PATH = AGENT_MAIL_PATH / "commands"
    RESULTS_PATH = AGENT_MAIL_PATH / "results"

    # Ensure directories exist
    COMMANDS_PATH.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.mkdir(parents=True, exist_ok=True)

    return ProjectResponse(**project)


# =============================================================================
# Skills Endpoints
# =============================================================================

@app.get("/api/skills")
async def list_available_skills():
    """List all available skills that can be installed."""
    return {"skills": get_available_skills()}


@app.get("/api/projects/{project_id}/skills")
async def list_project_skills(project_id: str):
    """List installed skills for a project."""
    from fastapi import HTTPException

    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project_root = Path(project["root_path"])
    installed = get_installed_skills(project_root)
    available = get_available_skills()

    # Mark which available skills are installed
    installed_ids = {s["id"] for s in installed}
    for skill in available:
        skill["installed"] = skill["id"] in installed_ids

    return {
        "installed": installed,
        "available": available,
    }


@app.post("/api/projects/{project_id}/skills/{skill_id}")
async def install_project_skill(project_id: str, skill_id: str):
    """Install a skill to a project."""
    from fastapi import HTTPException

    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Check if skill exists
    available = get_available_skills()
    if not any(s["id"] == skill_id for s in available):
        raise HTTPException(status_code=404, detail=f"Skill not found: {skill_id}")

    project_root = Path(project["root_path"])
    success = install_skill(project_root, skill_id)

    if not success:
        raise HTTPException(status_code=500, detail="Failed to install skill")

    return {"success": True, "skill_id": skill_id}


@app.delete("/api/projects/{project_id}/skills/{skill_id}")
async def uninstall_project_skill(project_id: str, skill_id: str):
    """Uninstall a skill from a project."""
    from fastapi import HTTPException

    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project_root = Path(project["root_path"])
    success = uninstall_skill(project_root, skill_id)

    if not success:
        raise HTTPException(status_code=404, detail=f"Skill not installed: {skill_id}")

    return {"success": True, "skill_id": skill_id}


# =============================================================================
# Team State Endpoint (workflow integration)
# =============================================================================

@app.get("/api/projects/{project_id}/team-state")
async def get_team_state(project_id: str):
    """Get team state from .claude/team-state.yaml."""
    from fastapi import HTTPException
    import yaml

    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    state_file = Path(project["root_path"]) / ".claude" / "team-state.yaml"

    if not state_file.exists():
        # Return default state if file doesn't exist
        return {
            "stage": "init",
            "mode": "scheduled",
            "agents": {},
            "sprint": None,
            "blockers": []
        }

    try:
        state = yaml.safe_load(state_file.read_text())
        return state
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse team state: {e}")


# =============================================================================
# Task Queue Endpoints
# =============================================================================

@app.get("/api/projects/{project_id}/tasks", response_model=list[TaskResponse])
async def list_tasks(
    project_id: str,
    status: Optional[str] = None,
    agent_id: Optional[str] = None,
    sprint_id: Optional[str] = None
):
    """List tasks for a project with optional filters."""
    from fastapi import HTTPException

    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    tasks = db.list_tasks(project_id, status=status, agent_id=agent_id, sprint_id=sprint_id)
    return [TaskResponse(**t) for t in tasks]


@app.post("/api/projects/{project_id}/tasks", response_model=TaskResponse)
async def create_task(project_id: str, request: TaskCreate):
    """Create a new task in the queue."""
    from fastapi import HTTPException

    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Validate agent_id if provided
    if request.agent_id:
        agent = db.get_agent(request.agent_id)
        if not agent or agent["project_id"] != project_id:
            raise HTTPException(status_code=400, detail="Invalid agent_id")

    # Validate sprint_id if provided
    if request.sprint_id:
        sprint = db.get_sprint(request.sprint_id)
        if not sprint or sprint["project_id"] != project_id:
            raise HTTPException(status_code=400, detail="Invalid sprint_id")

    # Validate dependencies
    for dep_id in request.depends_on:
        dep_task = db.get_task(dep_id)
        if not dep_task or dep_task["project_id"] != project_id:
            raise HTTPException(status_code=400, detail=f"Invalid dependency: {dep_id}")

    task = db.create_task(
        project_id=project_id,
        title=request.title,
        description=request.description,
        agent_id=request.agent_id,
        sprint_id=request.sprint_id,
        priority=request.priority,
        depends_on=request.depends_on if request.depends_on else None
    )

    # Broadcast task created
    await manager.broadcast({
        "type": "task_created",
        "data": {"task_id": task["id"], "title": task["title"]}
    })

    return TaskResponse(**task)


@app.get("/api/projects/{project_id}/tasks/{task_id}", response_model=TaskResponse)
async def get_task(project_id: str, task_id: str):
    """Get a task by ID."""
    from fastapi import HTTPException

    task = db.get_task(task_id)
    if not task or task["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Task not found")

    return TaskResponse(**task)


@app.put("/api/projects/{project_id}/tasks/{task_id}", response_model=TaskResponse)
async def update_task(project_id: str, task_id: str, request: TaskUpdate):
    """Update a task."""
    from fastapi import HTTPException

    task = db.get_task(task_id)
    if not task or task["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Task not found")

    updates = request.model_dump(exclude_unset=True)

    # Validate agent_id if provided
    if "agent_id" in updates and updates["agent_id"]:
        agent = db.get_agent(updates["agent_id"])
        if not agent or agent["project_id"] != project_id:
            raise HTTPException(status_code=400, detail="Invalid agent_id")

    task = db.update_task(task_id, **updates)
    return TaskResponse(**task)


@app.delete("/api/projects/{project_id}/tasks/{task_id}")
async def delete_task(project_id: str, task_id: str):
    """Delete a task."""
    from fastapi import HTTPException

    task = db.get_task(task_id)
    if not task or task["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Task not found")

    # Can't delete running tasks
    if task["status"] == "running":
        raise HTTPException(status_code=400, detail="Cannot delete running task")

    success = db.delete_task(task_id)
    return {"success": success}


@app.post("/api/projects/{project_id}/tasks/{task_id}/assign", response_model=TaskResponse)
async def assign_task(project_id: str, task_id: str, request: TaskAssign):
    """Manually assign a task to an agent."""
    from fastapi import HTTPException

    task = db.get_task(task_id)
    if not task or task["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Task not found")

    if task["status"] not in ("pending", "blocked"):
        raise HTTPException(status_code=400, detail=f"Cannot assign task with status: {task['status']}")

    agent = db.get_agent(request.agent_id)
    if not agent or agent["project_id"] != project_id:
        raise HTTPException(status_code=400, detail="Invalid agent_id")

    task = db.update_task(task_id, agent_id=request.agent_id)
    return TaskResponse(**task)


@app.post("/api/projects/{project_id}/tasks/{task_id}/retry", response_model=TaskResponse)
async def retry_task(project_id: str, task_id: str):
    """Retry a failed task."""
    from fastapi import HTTPException

    task = db.get_task(task_id)
    if not task or task["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Task not found")

    if task["status"] != "failed":
        raise HTTPException(status_code=400, detail="Can only retry failed tasks")

    scheduler = get_scheduler()
    if scheduler:
        await scheduler.retry_task(task_id)
    else:
        # Manual retry without scheduler
        db.update_task(
            task_id,
            status="pending",
            retry_count=0,
            agent_id=None,
            started_at=None,
            completed_at=None,
            error=None
        )

    return TaskResponse(**db.get_task(task_id))


@app.post("/api/projects/{project_id}/tasks/{task_id}/cancel")
async def cancel_task(project_id: str, task_id: str):
    """Cancel a running task."""
    from fastapi import HTTPException

    task = db.get_task(task_id)
    if not task or task["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Task not found")

    if task["status"] != "running":
        raise HTTPException(status_code=400, detail="Can only cancel running tasks")

    scheduler = get_scheduler()
    if scheduler:
        success = await scheduler.cancel_task(task_id)
    else:
        # Manual cancel without scheduler
        from datetime import datetime
        db.update_task(
            task_id,
            status="failed",
            completed_at=datetime.utcnow().isoformat(),
            error="Cancelled by user"
        )
        success = True

    return {"success": success}


@app.get("/api/projects/{project_id}/queue/stats", response_model=QueueStats)
async def get_queue_stats(project_id: str):
    """Get task queue statistics."""
    from fastapi import HTTPException

    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    stats = db.get_queue_stats(project_id)
    return QueueStats(**stats)


# =============================================================================
# Scheduler Control Endpoints
# =============================================================================

@app.get("/api/scheduler/status", response_model=SchedulerStatus)
async def get_scheduler_status():
    """Get scheduler status."""
    scheduler = get_scheduler()
    if not scheduler:
        return SchedulerStatus(
            running=False,
            project_id=None,
            interval=5.0
        )

    return SchedulerStatus(
        running=scheduler.is_running,
        project_id=scheduler.project_id,
        interval=scheduler.interval,
        last_run=scheduler.last_run
    )


@app.post("/api/scheduler/start", response_model=SchedulerStatus)
async def start_scheduler():
    """Start the task scheduler."""
    from fastapi import HTTPException

    scheduler = get_scheduler()
    if not scheduler:
        # Create scheduler for active project
        active_project = db.get_active_project()
        if not active_project:
            raise HTTPException(status_code=400, detail="No active project")

        scheduler = TaskScheduler(
            project_id=active_project["id"],
            project_root=Path(active_project["root_path"]),
            broadcast_callback=manager.broadcast,
            interval=5.0
        )
        set_scheduler(scheduler)

    await scheduler.start()

    return SchedulerStatus(
        running=scheduler.is_running,
        project_id=scheduler.project_id,
        interval=scheduler.interval,
        last_run=scheduler.last_run
    )


@app.post("/api/scheduler/stop", response_model=SchedulerStatus)
async def stop_scheduler():
    """Stop the task scheduler."""
    scheduler = get_scheduler()
    if scheduler:
        await scheduler.stop()

    return SchedulerStatus(
        running=False,
        project_id=scheduler.project_id if scheduler else None,
        interval=scheduler.interval if scheduler else 5.0,
        last_run=scheduler.last_run if scheduler else None
    )


# =============================================================================
# Task Template Endpoints
# =============================================================================

@app.get("/api/projects/{project_id}/templates", response_model=list[TaskTemplateResponse])
async def list_task_templates(project_id: str):
    """List all task templates for a project."""
    from fastapi import HTTPException

    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    templates = db.list_task_templates(project_id)
    return [TaskTemplateResponse(**t) for t in templates]


@app.post("/api/projects/{project_id}/templates", response_model=TaskTemplateResponse)
async def create_task_template(project_id: str, request: TaskTemplateCreate):
    """Create a new task template."""
    from fastapi import HTTPException

    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    template = db.create_task_template(
        project_id=project_id,
        name=request.name,
        title=request.title,
        description=request.description,
        priority=request.priority,
        agent_id=request.agent_id
    )

    return TaskTemplateResponse(**template)


@app.get("/api/projects/{project_id}/templates/{template_id}", response_model=TaskTemplateResponse)
async def get_task_template(project_id: str, template_id: str):
    """Get a specific task template."""
    from fastapi import HTTPException

    template = db.get_task_template(template_id)
    if not template or template["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Template not found")

    return TaskTemplateResponse(**template)


@app.put("/api/projects/{project_id}/templates/{template_id}", response_model=TaskTemplateResponse)
async def update_task_template(project_id: str, template_id: str, request: TaskTemplateUpdate):
    """Update a task template."""
    from fastapi import HTTPException

    template = db.get_task_template(template_id)
    if not template or template["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Template not found")

    updates = request.model_dump(exclude_unset=True)
    updated = db.update_task_template(template_id, **updates)

    return TaskTemplateResponse(**updated)


@app.delete("/api/projects/{project_id}/templates/{template_id}")
async def delete_task_template(project_id: str, template_id: str):
    """Delete a task template."""
    from fastapi import HTTPException

    template = db.get_task_template(template_id)
    if not template or template["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Template not found")

    db.delete_task_template(template_id)
    return {"status": "deleted"}


@app.post("/api/projects/{project_id}/templates/{template_id}/create-task", response_model=TaskResponse)
async def create_task_from_template(project_id: str, template_id: str, request: CreateFromTemplateRequest):
    """Create a new task from a template."""
    from fastapi import HTTPException

    template = db.get_task_template(template_id)
    if not template or template["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Template not found")

    task = db.create_task_from_template(template_id, sprint_id=request.sprint_id)
    if not task:
        raise HTTPException(status_code=500, detail="Failed to create task from template")

    await manager.broadcast({
        "type": "task_created",
        "data": {"task_id": task["id"]}
    })

    return TaskResponse(**task)


# =============================================================================
# Sprint Planning Endpoints
# =============================================================================

@app.get("/api/projects/{project_id}/sprints", response_model=list[SprintResponse])
async def list_sprints(project_id: str, status: Optional[str] = None):
    """List all sprints for a project."""
    from fastapi import HTTPException

    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    sprints = db.list_sprints(project_id, status=status)
    return [SprintResponse(**s) for s in sprints]


@app.post("/api/projects/{project_id}/sprints", response_model=SprintResponse)
async def create_sprint(project_id: str, request: SprintCreate):
    """Create a new sprint."""
    from fastapi import HTTPException

    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    sprint = db.create_sprint(
        project_id=project_id,
        name=request.name,
        goal=request.goal,
        start_date=request.start_date,
        end_date=request.end_date
    )

    await manager.broadcast({
        "type": "sprint_created",
        "data": {"sprint_id": sprint["id"], "name": sprint["name"]}
    })

    return SprintResponse(**sprint)


@app.get("/api/projects/{project_id}/sprints/{sprint_id}", response_model=SprintResponse)
async def get_sprint(project_id: str, sprint_id: str):
    """Get a sprint by ID."""
    from fastapi import HTTPException

    sprint = db.get_sprint(sprint_id)
    if not sprint or sprint["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Sprint not found")

    return SprintResponse(**sprint)


@app.put("/api/projects/{project_id}/sprints/{sprint_id}", response_model=SprintResponse)
async def update_sprint(project_id: str, sprint_id: str, request: SprintUpdate):
    """Update a sprint."""
    from fastapi import HTTPException

    sprint = db.get_sprint(sprint_id)
    if not sprint or sprint["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Sprint not found")

    updates = request.model_dump(exclude_unset=True)
    updated_sprint = db.update_sprint(sprint_id, **updates)

    await manager.broadcast({
        "type": "sprint_updated",
        "data": {"sprint_id": sprint_id}
    })

    return SprintResponse(**updated_sprint)


@app.delete("/api/projects/{project_id}/sprints/{sprint_id}")
async def delete_sprint(project_id: str, sprint_id: str):
    """Delete a sprint (tasks remain but lose sprint assignment)."""
    from fastapi import HTTPException

    sprint = db.get_sprint(sprint_id)
    if not sprint or sprint["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Sprint not found")

    db.delete_sprint(sprint_id)

    await manager.broadcast({
        "type": "sprint_deleted",
        "data": {"sprint_id": sprint_id}
    })

    return {"status": "deleted"}


@app.get("/api/projects/{project_id}/sprints/{sprint_id}/stats", response_model=SprintStats)
async def get_sprint_stats(project_id: str, sprint_id: str):
    """Get task statistics for a sprint."""
    from fastapi import HTTPException

    sprint = db.get_sprint(sprint_id)
    if not sprint or sprint["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Sprint not found")

    stats = db.get_sprint_stats(sprint_id)

    # Calculate completion percentage
    completion = 0.0
    if stats["total"] > 0:
        completion = (stats["completed"] / stats["total"]) * 100

    return SprintStats(**stats, completion_percent=round(completion, 1))


@app.post("/api/projects/{project_id}/sprints/{sprint_id}/start")
async def start_sprint(project_id: str, sprint_id: str):
    """Start a sprint (set status to active)."""
    from fastapi import HTTPException
    from datetime import datetime

    sprint = db.get_sprint(sprint_id)
    if not sprint or sprint["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Sprint not found")

    if sprint["status"] != "planning":
        raise HTTPException(status_code=400, detail="Sprint is not in planning status")

    db.update_sprint(sprint_id, status="active", start_date=datetime.utcnow().isoformat())

    await manager.broadcast({
        "type": "sprint_started",
        "data": {"sprint_id": sprint_id}
    })

    return {"status": "started"}


@app.post("/api/projects/{project_id}/sprints/{sprint_id}/complete")
async def complete_sprint(project_id: str, sprint_id: str):
    """Complete a sprint."""
    from fastapi import HTTPException
    from datetime import datetime

    sprint = db.get_sprint(sprint_id)
    if not sprint or sprint["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Sprint not found")

    if sprint["status"] != "active":
        raise HTTPException(status_code=400, detail="Sprint is not active")

    db.update_sprint(sprint_id, status="completed", end_date=datetime.utcnow().isoformat())

    await manager.broadcast({
        "type": "sprint_completed",
        "data": {"sprint_id": sprint_id}
    })

    return {"status": "completed"}


@app.get("/api/projects/{project_id}/sprints/{sprint_id}/burndown")
async def get_sprint_burndown(project_id: str, sprint_id: str):
    """Get burndown data for a sprint."""
    from fastapi import HTTPException

    sprint = db.get_sprint(sprint_id)
    if not sprint or sprint["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Sprint not found")

    return db.get_sprint_burndown(sprint_id)


@app.get("/api/projects/{project_id}/velocity")
async def get_velocity(project_id: str, limit: int = 10):
    """Get velocity data for completed sprints."""
    return db.get_velocity_data(project_id, limit)


# =============================================================================
# Usage Analytics Endpoints
# =============================================================================

# Model pricing (per 1M tokens) - based on Anthropic API pricing
MODEL_PRICING = {
    "claude-opus-4-5-20251101": {
        "input": 15.0,
        "output": 75.0,
        "cache_read": 1.5,
        "cache_creation": 18.75,
    },
    "claude-sonnet-4-5-20250929": {
        "input": 3.0,
        "output": 15.0,
        "cache_read": 0.3,
        "cache_creation": 3.75,
    },
    "claude-opus-4-1-20250805": {
        "input": 15.0,
        "output": 75.0,
        "cache_read": 1.5,
        "cache_creation": 18.75,
    },
}


def calculate_model_cost(model_id: str, usage: dict) -> float:
    """Calculate estimated cost for a model's usage."""
    pricing = MODEL_PRICING.get(model_id)
    if not pricing:
        # Default to Opus pricing for unknown models
        pricing = MODEL_PRICING["claude-opus-4-5-20251101"]

    input_cost = (usage.get("inputTokens", 0) / 1_000_000) * pricing["input"]
    output_cost = (usage.get("outputTokens", 0) / 1_000_000) * pricing["output"]
    cache_read_cost = (usage.get("cacheReadInputTokens", 0) / 1_000_000) * pricing["cache_read"]
    cache_creation_cost = (usage.get("cacheCreationInputTokens", 0) / 1_000_000) * pricing["cache_creation"]

    return input_cost + output_cost + cache_read_cost + cache_creation_cost


@app.get("/api/usage", response_model=UsageAnalytics)
async def get_usage_analytics(days: int = 30):
    """Get Claude Code usage analytics from stats-cache.json.

    Args:
        days: Number of days to include in daily activity (default 30)
    """
    from datetime import datetime, timedelta

    stats_file = Path.home() / ".claude" / "stats-cache.json"

    if not stats_file.exists():
        return UsageAnalytics(
            total_sessions=0,
            total_messages=0,
            models=[],
            daily_activity=[],
            total_estimated_cost_usd=0.0,
            period_days=days
        )

    try:
        stats = json.loads(stats_file.read_text())
    except Exception:
        return UsageAnalytics(
            total_sessions=0,
            total_messages=0,
            models=[],
            daily_activity=[],
            total_estimated_cost_usd=0.0,
            period_days=days
        )

    # Parse model usage
    models = []
    total_cost = 0.0
    model_usage = stats.get("modelUsage", {})

    for model_id, usage in model_usage.items():
        cost = calculate_model_cost(model_id, usage)
        total_cost += cost

        models.append(ModelUsage(
            model_id=model_id,
            input_tokens=usage.get("inputTokens", 0),
            output_tokens=usage.get("outputTokens", 0),
            cache_read_tokens=usage.get("cacheReadInputTokens", 0),
            cache_creation_tokens=usage.get("cacheCreationInputTokens", 0),
            estimated_cost_usd=round(cost, 2)
        ))

    # Parse daily activity (last N days)
    daily_activity = []
    cutoff_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    # Build a lookup for token data by date
    token_by_date = {}
    for entry in stats.get("dailyModelTokens", []):
        token_by_date[entry["date"]] = entry.get("tokensByModel", {})

    for entry in stats.get("dailyActivity", []):
        if entry["date"] >= cutoff_date:
            daily_activity.append(DailyActivity(
                date=entry["date"],
                message_count=entry.get("messageCount", 0),
                session_count=entry.get("sessionCount", 0),
                tool_call_count=entry.get("toolCallCount", 0),
                tokens_by_model=token_by_date.get(entry["date"], {})
            ))

    # Sort by date descending
    daily_activity.sort(key=lambda x: x.date, reverse=True)

    return UsageAnalytics(
        total_sessions=stats.get("totalSessions", 0),
        total_messages=stats.get("totalMessages", 0),
        first_session_date=stats.get("firstSessionDate"),
        models=models,
        daily_activity=daily_activity,
        total_estimated_cost_usd=round(total_cost, 2),
        period_days=days
    )


# =============================================================================
# Agent Endpoints (per project)
# =============================================================================

@app.get("/api/projects/{project_id}/agents", response_model=list[AgentResponse])
async def list_project_agents(project_id: str):
    """List all agents for a project."""
    agents = db.list_agents(project_id)
    return [AgentResponse(**a) for a in agents]


@app.post("/api/projects/{project_id}/agents", response_model=AgentResponse)
async def create_agent(project_id: str, request: AgentCreate):
    """Create a new agent for a project."""
    project = db.get_project(project_id)
    if not project:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Project not found")

    # Check if agent name already exists
    existing = db.get_agent_by_name(project_id, request.name)
    if existing:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Agent '{request.name}' already exists")

    # Calculate worktree path
    project_root = Path(project["root_path"])
    parent_dir = project_root.parent
    worktree_path = parent_dir / f"{project_root.name}-{request.name}"

    # Check if project is a git repository
    git_dir = project_root / ".git"
    if not git_dir.exists():
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Project is not a git repository")

    # Create git worktree for the agent
    try:
        # Create worktree from current HEAD
        result = subprocess.run(
            ["git", "worktree", "add", "--detach", str(worktree_path), "HEAD"],
            cwd=str(project_root),
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            # Check if worktree already exists
            if "already exists" in result.stderr:
                pass  # Worktree exists, continue
            else:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to create git worktree: {result.stderr}"
                )
    except FileNotFoundError:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail="git command not found")

    # Create agent in database
    agent = db.create_agent(project_id, request.name, request.domain, str(worktree_path))

    # Create AGENTS.md in the domain folder to define agent responsibilities
    try:
        from datetime import datetime, timezone

        domain_path = project_root / request.domain
        if domain_path.exists() and domain_path.is_dir():
            agents_md = domain_path / "AGENTS.md"

            # Create AGENTS.md content
            content = f"""# {request.name.title()} Agent

## Domain
`{request.domain}/`

## Worktree
`{worktree_path}`

## Responsibilities
- Manage all code within `{request.domain}/`
- Handle tasks dispatched by leader agent
- Report results back to leader

## Created
{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}

## Notes
This agent was created via the Claude Code Web IDE.
"""
            # Only create if doesn't exist (don't overwrite user customizations)
            if not agents_md.exists():
                with open(agents_md, "w") as f:
                    f.write(content)

    except Exception as e:
        # Don't fail agent creation if AGENTS.md creation fails
        print(f"Warning: Failed to create AGENTS.md: {e}")

    return AgentResponse(**agent)


@app.get("/api/projects/{project_id}/agents/{agent_id}", response_model=AgentResponse)
async def get_agent(project_id: str, agent_id: str):
    """Get an agent by ID."""
    agent = db.get_agent(agent_id)
    if not agent or agent["project_id"] != project_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Agent not found")
    return AgentResponse(**agent)


@app.put("/api/projects/{project_id}/agents/{agent_id}", response_model=AgentResponse)
async def update_agent(project_id: str, agent_id: str, request: AgentUpdate):
    """Update an agent."""
    agent = db.get_agent(agent_id)
    if not agent or agent["project_id"] != project_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Agent not found")

    updates = request.model_dump(exclude_unset=True)
    agent = db.update_agent(agent_id, **updates)
    return AgentResponse(**agent)


@app.delete("/api/projects/{project_id}/agents/{agent_id}")
async def delete_agent(project_id: str, agent_id: str):
    """Delete an agent (cannot delete leader)."""
    agent = db.get_agent(agent_id)
    if not agent or agent["project_id"] != project_id:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Agent not found")

    if agent["is_leader"]:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Cannot delete leader agent")

    # Get project for git operations
    project = db.get_project(project_id)
    worktree_path = agent.get("worktree_path")

    # Remove git worktree if it exists
    if worktree_path and project:
        project_root = Path(project["root_path"])
        try:
            result = subprocess.run(
                ["git", "worktree", "remove", "--force", worktree_path],
                cwd=str(project_root),
                capture_output=True,
                text=True
            )
            if result.returncode != 0 and "is not a working tree" not in result.stderr:
                print(f"Warning: Failed to remove worktree: {result.stderr}")
        except FileNotFoundError:
            pass  # git not found, skip worktree removal
        except Exception as e:
            print(f"Warning: Error removing worktree: {e}")

    success = db.delete_agent(agent_id)
    return {"success": success}


@app.post("/api/projects/{project_id}/sync-worktrees")
async def sync_worktrees(project_id: str):
    """Detect existing git worktrees and register them as agents."""
    from fastapi import HTTPException

    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project_root = Path(project["root_path"])
    project_name = project_root.name

    # Check if project is a git repository
    if not (project_root / ".git").exists():
        raise HTTPException(status_code=400, detail="Project is not a git repository")

    # Get existing worktrees
    try:
        result = subprocess.run(
            ["git", "worktree", "list", "--porcelain"],
            cwd=str(project_root),
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Failed to list worktrees: {result.stderr}")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="git command not found")

    # Parse worktree list
    worktrees = []
    current = {}
    for line in result.stdout.strip().split("\n"):
        if line.startswith("worktree "):
            if current:
                worktrees.append(current)
            current = {"path": line[9:]}
        elif line.startswith("HEAD "):
            current["head"] = line[5:]
        elif line.startswith("branch "):
            current["branch"] = line[7:]
        elif line == "detached":
            current["detached"] = True
    if current:
        worktrees.append(current)

    # Get existing agents
    existing_agents = db.list_agents(project_id)
    existing_paths = {a["worktree_path"] for a in existing_agents if a["worktree_path"]}

    # Register new worktrees as agents
    created = []
    skipped = []

    for wt in worktrees:
        wt_path = wt["path"]

        # Skip main project (leader)
        if wt_path == str(project_root):
            continue

        # Skip already registered
        if wt_path in existing_paths:
            skipped.append(wt_path)
            continue

        # Derive agent name from folder name
        # e.g., /home/user/lab/fluxa-api -> api
        folder_name = Path(wt_path).name
        if folder_name.startswith(f"{project_name}-"):
            agent_name = folder_name[len(project_name) + 1:]
        else:
            agent_name = folder_name

        # Check if agent name exists
        if db.get_agent_by_name(project_id, agent_name):
            # Append suffix to make unique
            agent_name = f"{agent_name}-wt"

        # Domain is unknown for existing worktrees, set to agent name
        domain = agent_name

        # Create agent
        agent = db.create_agent(project_id, agent_name, domain, wt_path)
        created.append({
            "name": agent_name,
            "worktree_path": wt_path,
            "id": agent["id"]
        })

    return {
        "created": created,
        "skipped": skipped,
        "total_worktrees": len(worktrees)
    }


# =============================================================================
# Settings Endpoints
# =============================================================================

@app.get("/api/settings", response_model=SettingsResponse)
async def get_settings():
    """Get global settings."""
    settings = db.get_settings()
    return SettingsResponse(**settings)


@app.put("/api/settings", response_model=SettingsResponse)
async def update_settings(request: SettingsUpdate):
    """Update global settings."""
    updates = request.model_dump(exclude_unset=True)
    settings = db.update_settings(**updates)
    return SettingsResponse(**settings)


@app.get("/api/projects/{project_id}/settings", response_model=ProjectSettingsResponse)
async def get_project_settings(project_id: str):
    """Get project-specific settings."""
    project = db.get_project(project_id)
    if not project:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Project not found")

    settings = db.get_project_settings(project_id)
    return ProjectSettingsResponse(**settings)


@app.put("/api/projects/{project_id}/settings", response_model=ProjectSettingsResponse)
async def update_project_settings(project_id: str, request: ProjectSettingsUpdate):
    """Update project-specific settings."""
    project = db.get_project(project_id)
    if not project:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Project not found")

    updates = request.model_dump(exclude_unset=True)
    settings = db.update_project_settings(project_id, **updates)
    return ProjectSettingsResponse(**settings)


# =============================================================================
# File System Endpoints
# =============================================================================

@app.get("/api/projects/{project_id}/modules")
async def list_project_modules(project_id: str, subpath: str = ""):
    """List subdirectories (modules) within a project for agent domain selection.

    Args:
        subpath: Relative path within the project to browse (e.g., "apps" or "apps/api")
    """
    from fastapi import HTTPException

    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project_root = Path(project["root_path"])
    if not project_root.exists():
        raise HTTPException(status_code=404, detail="Project path not found")

    # Build the target path
    if subpath:
        target_path = project_root / subpath
        # Security: ensure we don't escape project root
        try:
            target_path.resolve().relative_to(project_root.resolve())
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid path")
    else:
        target_path = project_root

    if not target_path.exists() or not target_path.is_dir():
        raise HTTPException(status_code=404, detail="Path not found")

    modules = []
    try:
        for item in sorted(target_path.iterdir(), key=lambda x: x.name.lower()):
            # Only show directories, skip hidden ones (starting with .)
            if item.is_dir() and not item.name.startswith('.'):
                # Calculate relative path from project root
                rel_path = str(item.relative_to(project_root))
                modules.append({
                    "name": item.name,
                    "path": str(item),
                    "relative_path": rel_path,
                })
    except PermissionError:
        pass

    return {
        "modules": modules,
        "project_root": str(project_root),
        "current_path": subpath,
    }


@app.get("/api/files/browse")
async def browse_directories(path: str = None):
    """Browse directories for path selection. Returns only directories."""
    from fastapi import HTTPException

    # Default to home directory if no path provided
    if not path:
        path = str(Path.home())

    target_path = Path(path)
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="Path not found")
    if not target_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    directories = []
    try:
        for item in sorted(target_path.iterdir(), key=lambda x: x.name.lower()):
            if item.is_dir():
                # Check if it's a git repository
                is_git_repo = (item / ".git").exists()
                directories.append({
                    "name": item.name,
                    "path": str(item),
                    "is_git_repo": is_git_repo,
                })
    except PermissionError:
        pass

    # Get parent directory
    parent = str(target_path.parent) if target_path.parent != target_path else None

    return {
        "current_path": str(target_path),
        "parent": parent,
        "directories": directories,
    }


@app.get("/api/files/tree")
async def get_file_tree(path: str):
    """Get directory tree for a path."""
    from fastapi import HTTPException

    target_path = Path(path)
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="Path not found")
    if not target_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    # Get git status for the repo
    git_status = {}
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(target_path),
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            for line in result.stdout.strip().split('\n'):
                if line:
                    status = line[:2].strip()
                    file_path = line[3:]
                    git_status[file_path] = status[0] if status else '?'
    except:
        pass

    def build_tree(dir_path: Path, relative_base: Path) -> dict:
        children = []
        try:
            for item in sorted(dir_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                # Skip hidden and common ignored directories
                if item.name.startswith('.') or item.name in ['node_modules', '__pycache__', '.venv', 'venv', '.git']:
                    continue

                relative = item.relative_to(relative_base)
                node = {
                    "name": item.name,
                    "path": str(item),
                    "is_dir": item.is_dir(),
                    "git_status": git_status.get(str(relative)),
                }

                if item.is_dir():
                    node["children"] = build_tree(item, relative_base)["children"]
                else:
                    try:
                        stat = item.stat()
                        node["size"] = stat.st_size
                        node["modified"] = stat.st_mtime
                    except:
                        pass

                children.append(node)
        except PermissionError:
            pass

        return {"name": dir_path.name, "path": str(dir_path), "is_dir": True, "children": children}

    tree = build_tree(target_path, target_path)
    return tree


@app.get("/api/files/content")
async def get_file_content(path: str):
    """Read file content."""
    from fastapi import HTTPException

    file_path = Path(path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not file_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    try:
        content = file_path.read_text(encoding='utf-8')
        stat = file_path.stat()
        return {
            "path": path,
            "content": content,
            "encoding": "utf-8",
            "size": stat.st_size,
            "modified": stat.st_mtime,
        }
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File is not a text file")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/files/content")
async def write_file_content(request: dict):
    """Write file content."""
    from fastapi import HTTPException

    path = request.get("path")
    content = request.get("content")

    if not path or content is None:
        raise HTTPException(status_code=400, detail="Missing path or content")

    file_path = Path(path)
    if not file_path.parent.exists():
        raise HTTPException(status_code=404, detail="Parent directory not found")

    try:
        file_path.write_text(content, encoding='utf-8')
        stat = file_path.stat()
        return {
            "path": path,
            "size": stat.st_size,
            "modified": stat.st_mtime,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/files/create")
async def create_file_or_folder(request: dict):
    """Create a file or folder."""
    from fastapi import HTTPException

    path = request.get("path")
    is_dir = request.get("is_dir", False)
    content = request.get("content", "")

    if not path:
        raise HTTPException(status_code=400, detail="Missing path")

    target_path = Path(path)
    if target_path.exists():
        raise HTTPException(status_code=400, detail="Path already exists")

    try:
        if is_dir:
            target_path.mkdir(parents=True, exist_ok=True)
        else:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_text(content, encoding='utf-8')

        return {"path": path, "is_dir": is_dir}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/files")
async def delete_file_or_folder(path: str):
    """Delete a file or folder."""
    from fastapi import HTTPException
    import shutil

    target_path = Path(path)
    if not target_path.exists():
        raise HTTPException(status_code=404, detail="Path not found")

    try:
        if target_path.is_dir():
            shutil.rmtree(target_path)
        else:
            target_path.unlink()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/files/rename")
async def rename_file(request: dict):
    """Rename or move a file/folder."""
    from fastapi import HTTPException

    old_path = request.get("old_path")
    new_path = request.get("new_path")

    if not old_path or not new_path:
        raise HTTPException(status_code=400, detail="Missing old_path or new_path")

    src = Path(old_path)
    dst = Path(new_path)

    if not src.exists():
        raise HTTPException(status_code=404, detail="Source path not found")
    if dst.exists():
        raise HTTPException(status_code=400, detail="Destination path already exists")

    try:
        src.rename(dst)
        return {"old_path": old_path, "new_path": new_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Chat Endpoints

@app.post("/api/chat")
async def start_chat(request: ChatRequest):
    """
    Start a chat with an agent. Returns a chat_id for WebSocket streaming.
    """
    chat_id = str(uuid.uuid4())[:8]

    return {
        "chat_id": chat_id,
        "agent": request.agent,
        "message": request.message,
        "resume": request.resume,
        "session_id": request.session_id,
        "ws_url": f"/ws/chat/{chat_id}"
    }


# WebSocket for Chat Streaming
chat_connections: dict[str, WebSocket] = {}


@app.websocket("/ws/chat/{chat_id}")
async def chat_websocket(websocket: WebSocket, chat_id: str):
    """WebSocket endpoint for streaming chat responses with bidirectional communication."""
    await websocket.accept()
    chat_connections[chat_id] = websocket
    print(f"[CHAT] WebSocket connected: {chat_id}")

    runner = None

    try:
        # Wait for initial message with chat params
        init_data = await websocket.receive_json()
        print(f"[CHAT] Received init: {init_data}")

        agent = init_data.get("agent", "leader")
        message = init_data.get("message", "")
        images = init_data.get("images", [])  # List of base64 data URLs
        resume = init_data.get("resume", True)
        session_id = init_data.get("session_id")
        mode = init_data.get("mode", "normal")  # normal, plan, auto, yolo

        # Generate session_id if not provided
        if not session_id:
            import uuid
            session_id = str(uuid.uuid4())[:8]

        if not message and not images:
            await websocket.send_json({"type": "error", "message": "No message provided"})
            return

        # Create runner for this chat
        runner = ClaudeRunner(agent)
        print(f"[CHAT] Starting Claude runner for agent={agent}, workdir={runner.workdir}, images={len(images)}, mode={mode}, session_id={session_id}")

        # Send start notification with session_id
        await websocket.send_json({
            "type": "chat_start",
            "agent": agent,
            "message": message,
            "image_count": len(images),
            "mode": mode,
            "session_id": session_id
        })

        # Stream output with bidirectional handling
        output_count = 0
        async for output in runner.run_chat(message, session_id, resume, images=images, mode=mode):
            output_count += 1
            output_type = output.get('type')
            print(f"[CHAT] Output #{output_count}: type={output_type}")
            await websocket.send_json(output)

            # If this is a permission request, wait for user response
            if output_type == "permission_request":
                print(f"[CHAT] Waiting for permission response...")
                try:
                    # Wait for user's permission response (5 min timeout)
                    user_response = await asyncio.wait_for(
                        websocket.receive_json(),
                        timeout=300
                    )
                    response_type = user_response.get("type")
                    print(f"[CHAT] Received: {response_type}")

                    if response_type == "permission_response":
                        response_value = user_response.get("response", "")
                        print(f"[CHAT] Permission response: {response_value}")
                        await runner.send_input(response_value)
                    elif response_type == "stop":
                        await runner.stop()
                        break

                except asyncio.TimeoutError:
                    print("[CHAT] Permission response timeout")
                    await websocket.send_json({"type": "error", "message": "Permission response timeout"})
                    await runner.stop()
                    break
            else:
                # Quick non-blocking check for stop signal
                try:
                    stop_check = await asyncio.wait_for(
                        websocket.receive_json(),
                        timeout=0.01
                    )
                    if stop_check.get("type") == "stop":
                        await runner.stop()
                        break
                    elif stop_check.get("type") == "permission_response":
                        # Handle late permission response
                        await runner.send_input(stop_check.get("response", ""))
                except asyncio.TimeoutError:
                    pass  # No message, continue

        print(f"[CHAT] Done streaming, total outputs: {output_count}")
        await websocket.send_json({"type": "chat_done"})

    except WebSocketDisconnect:
        if runner:
            await runner.stop()
    except Exception as e:
        print(f"[CHAT] Error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except:
            pass
        if runner:
            await runner.stop()
    finally:
        if chat_id in chat_connections:
            del chat_connections[chat_id]


# WebSocket for General Updates

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates."""
    await manager.connect(websocket)

    # Send current state on connect
    try:
        state = await get_state()
        await websocket.send_json({
            "type": "connected",
            "data": {
                "state": state.model_dump(),
                "agents": [a.model_dump() for a in await get_agents()]
            },
            "timestamp": time.time()
        })
    except Exception as e:
        print(f"Error sending initial state: {e}")

    try:
        while True:
            # Keep connection alive, handle incoming messages
            data = await websocket.receive_text()
            # Could handle client-to-server messages here if needed
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# Static files and UI

def get_react_app():
    """Get the React app HTML."""
    app_path = Path(__file__).parent / "static" / "app" / "index.html"
    if app_path.exists():
        return HTMLResponse(content=app_path.read_text())
    return HTMLResponse(content="<h1>IDE not built</h1><p>Run 'npm run build' in web/</p>")


@app.get("/", response_class=HTMLResponse)
async def root():
    """Serve the React IDE app (Project Dashboard)."""
    return get_react_app()


@app.get("/ide", response_class=HTMLResponse)
@app.get("/ide/{path:path}", response_class=HTMLResponse)
async def ide_app(path: str = ""):
    """Serve the React IDE app."""
    return get_react_app()


# Legacy routes (old vanilla JS dashboard)
@app.get("/legacy", response_class=HTMLResponse)
async def legacy_root():
    """Serve the legacy dashboard."""
    static_path = Path(__file__).parent / "static" / "legacy" / "index.html"
    if static_path.exists():
        return HTMLResponse(content=static_path.read_text())
    return HTMLResponse(content="<h1>Legacy dashboard not found</h1>")


@app.get("/legacy/agent/{agent_name}", response_class=HTMLResponse)
async def legacy_agent_sessions(agent_name: str):
    """Serve the legacy sessions page."""
    static_path = Path(__file__).parent / "static" / "legacy" / "sessions.html"
    if static_path.exists():
        return HTMLResponse(content=static_path.read_text())
    return HTMLResponse(content=f"<h1>Sessions for {agent_name}</h1>")


@app.get("/legacy/chat/{session_id}", response_class=HTMLResponse)
@app.get("/legacy/chat", response_class=HTMLResponse)
async def legacy_chat(session_id: str = None):
    """Serve the legacy chat page."""
    static_path = Path(__file__).parent / "static" / "legacy" / "chat.html"
    if static_path.exists():
        return HTMLResponse(content=static_path.read_text())
    return HTMLResponse(content="<h1>Legacy chat not found</h1>")


# Mount static files
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


if __name__ == "__main__":
    import uvicorn
    print(f"Starting Agent Monitor on http://0.0.0.0:{PORT}")
    print(f"Access from phone: http://<your-ip>:{PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
