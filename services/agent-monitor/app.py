"""
Agent Activity Monitor v2 - Interactive chat interface for Claude Code agents.

Provides a web interface to:
- Monitor agent activities in real-time
- View session history and conversation logs
- Chat interactively with agents via Claude Code
"""

import asyncio
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from config import AGENT_MAIL_PATH, COMMANDS_PATH, RESULTS_PATH, PORT
from services.websocket import manager
from watcher import AgentMailWatcher, SessionWatcher
from scheduler import TaskScheduler, get_scheduler, set_scheduler
import database as db

# Import route modules
from routes import (
    state,
    commands,
    projects,
    agents,
    tasks,
    scheduler,
    sprints,
    templates,
    skills,
    sessions,
    files,
    chat,
    settings,
    usage,
    brainstorm,
)

# Global watchers
watcher = None
session_watcher = None


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
    claude_projects_dir = Path.home() / ".claude" / "projects"
    if claude_projects_dir.exists():
        for project_dir in claude_projects_dir.iterdir():
            if project_dir.is_dir():
                session_watcher.add_path(project_dir)

    session_watcher.start(loop)

    # Initialize scheduler if there's an active project
    active_project = db.get_active_project()
    if active_project:
        task_scheduler = TaskScheduler(
            project_id=active_project["id"],
            project_root=Path(active_project["root_path"]),
            broadcast_callback=manager.broadcast,
            interval=5.0
        )
        set_scheduler(task_scheduler)

    yield

    # Cleanup
    task_scheduler = get_scheduler()
    if task_scheduler and task_scheduler.is_running:
        await task_scheduler.stop()
    set_scheduler(None)

    if watcher:
        watcher.stop()
    if session_watcher:
        session_watcher.stop()


app = FastAPI(
    title="Agent Activity Monitor",
    description="Real-time monitoring for Claude Code agents",
    version="2.0.0",
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

# Register routes
app.include_router(state.router)
app.include_router(commands.router)
app.include_router(projects.router)
app.include_router(agents.router)
app.include_router(tasks.router)
app.include_router(scheduler.router)
app.include_router(sprints.router)
app.include_router(templates.router)
app.include_router(skills.router)
app.include_router(sessions.router)
app.include_router(files.router)
app.include_router(chat.router)
app.include_router(settings.router)
app.include_router(usage.router)
app.include_router(brainstorm.router)

# Add sync-worktrees endpoint at project level (not under agents)
from routes.agents import sync_worktrees
app.post("/api/projects/{project_id}/sync-worktrees")(sync_worktrees)

# Add queue stats endpoint at project level
from routes.tasks import get_queue_stats
app.get("/api/projects/{project_id}/queue/stats")(get_queue_stats)

# Add velocity endpoint at project level
from routes.sprints import get_velocity
app.get("/api/projects/{project_id}/velocity")(get_velocity)


# WebSocket for General Updates
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates."""
    await manager.connect(websocket)

    try:
        state_data = await state.get_state()
        agents_data = await state.get_agents()
        await websocket.send_json({
            "type": "connected",
            "data": {
                "state": state_data.model_dump(),
                "agents": [a.model_dump() for a in agents_data]
            },
            "timestamp": time.time()
        })
    except Exception as e:
        print(f"Error sending initial state: {e}")

    try:
        while True:
            data = await websocket.receive_text()
            # Handle client-to-server messages if needed
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


# Legacy routes
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
