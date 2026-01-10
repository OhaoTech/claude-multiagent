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
    ProjectSettingsResponse, ProjectSettingsUpdate
)
from watcher import AgentMailWatcher
from sessions import get_all_sessions, get_sessions_for_agent, get_session_messages
from claude_runner import ClaudeRunner, chat_manager
import database as db

# Configuration
REPO_ROOT = Path(os.environ.get("REPO_ROOT", "/home/frankyin/Desktop/lab/fluxa"))
AGENT_MAIL_PATH = REPO_ROOT / ".agent-mail"
COMMANDS_PATH = AGENT_MAIL_PATH / "commands"
RESULTS_PATH = AGENT_MAIL_PATH / "results"
PORT = int(os.environ.get("PORT", 8888))

# Note: Agents are now managed in the database, not hardcoded here.
# Use the /api/projects/{id}/sync-worktrees endpoint to import existing git worktrees.


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle."""
    global watcher

    # Ensure directories exist
    COMMANDS_PATH.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.mkdir(parents=True, exist_ok=True)

    # Start file watcher
    loop = asyncio.get_event_loop()
    watcher = AgentMailWatcher(AGENT_MAIL_PATH, manager.broadcast)
    watcher.start(loop)

    yield

    # Cleanup
    if watcher:
        watcher.stop()


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
