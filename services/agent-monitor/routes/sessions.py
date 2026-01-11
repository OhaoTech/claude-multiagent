"""Session endpoints."""

from fastapi import APIRouter

from models import SessionInfo
from sessions import get_all_sessions, get_sessions_for_agent, get_session_messages
import database as db

router = APIRouter(prefix="/api", tags=["sessions"])


@router.get("/sessions")
async def list_all_sessions(limit: int = 50) -> list[SessionInfo]:
    """Get all sessions for the active project."""
    active_project = db.get_active_project()
    project_root = None
    agents = None

    if active_project:
        project_root = active_project.get("root_path")
        agents = db.list_agents(active_project["id"])

    sessions = get_all_sessions(project_root, agents)
    return sessions[:limit]


@router.get("/sessions/{agent}")
async def list_agent_sessions(agent: str, limit: int = 50) -> list[SessionInfo]:
    """Get sessions for a specific agent within the active project."""
    active_project = db.get_active_project()
    project_root = None
    agents = None

    if active_project:
        project_root = active_project.get("root_path")
        agents = db.list_agents(active_project["id"])

    sessions = get_sessions_for_agent(agent, project_root, agents)
    return sessions[:limit]


@router.get("/session/{session_id}")
async def get_session(session_id: str):
    """Get full conversation history for a session."""
    messages = get_session_messages(session_id)
    return {
        "session_id": session_id,
        "messages": [m.model_dump() for m in messages],
        "count": len(messages)
    }
