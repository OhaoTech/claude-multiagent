"""Session endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from models import SessionInfo
from sessions import get_all_sessions, get_sessions_for_agent, get_session_messages
import database as db

router = APIRouter(prefix="/api", tags=["sessions"])


class SessionUpdate(BaseModel):
    nickname: Optional[str] = None


@router.get("/sessions")
async def list_all_sessions(limit: int = 50) -> list[dict]:
    """Get all sessions for the active project (excludes deleted)."""
    active_project = db.get_active_project()
    project_root = None
    agents = None

    if active_project:
        project_root = active_project.get("root_path")
        agents = db.list_agents(active_project["id"])

    sessions = get_all_sessions(project_root, agents)

    # Get metadata and filter out deleted sessions and warmup sessions
    metadata = db.get_all_session_metadata()
    result = []
    for s in sessions:
        meta = metadata.get(s.session_id, {})
        if meta.get("is_deleted"):
            continue
        # Filter out warmup/initialization sessions (low message count with warmup preview)
        preview = (s.last_message_preview or "").lower()
        if s.message_count <= 5 and ("warmup" in preview or "warm up" in preview or "i understand this is a warmup" in preview):
            continue
        session_dict = s.model_dump()
        session_dict["nickname"] = meta.get("nickname")
        result.append(session_dict)

    return result[:limit]


@router.get("/sessions/trash")
async def list_deleted_sessions():
    """Get all sessions in recycle bin for the active project."""
    active_project = db.get_active_project()
    project_id = active_project["id"] if active_project else None

    deleted_metadata = db.get_deleted_sessions(project_id)

    # Get actual session data for deleted sessions
    if not active_project:
        return []

    project_root = active_project.get("root_path")
    agents = db.list_agents(active_project["id"])
    all_sessions = get_all_sessions(project_root, agents)

    # Build map of session_id -> session
    session_map = {s.session_id: s for s in all_sessions}

    result = []
    for meta in deleted_metadata:
        session = session_map.get(meta["session_id"])
        if session:
            session_dict = session.model_dump()
            session_dict["nickname"] = meta.get("nickname")
            session_dict["deleted_at"] = meta.get("deleted_at")
            result.append(session_dict)

    return result


@router.get("/sessions/{agent}")
async def list_agent_sessions(agent: str, limit: int = 50) -> list[dict]:
    """Get sessions for a specific agent within the active project (excludes deleted)."""
    active_project = db.get_active_project()
    project_root = None
    agents = None

    if active_project:
        project_root = active_project.get("root_path")
        agents = db.list_agents(active_project["id"])

    sessions = get_sessions_for_agent(agent, project_root, agents)

    # Get metadata and filter out deleted sessions and warmup sessions
    metadata = db.get_all_session_metadata()
    result = []
    for s in sessions:
        meta = metadata.get(s.session_id, {})
        if meta.get("is_deleted"):
            continue
        # Filter out warmup/initialization sessions (low message count with warmup preview)
        preview = (s.last_message_preview or "").lower()
        if s.message_count <= 5 and ("warmup" in preview or "warm up" in preview or "i understand this is a warmup" in preview):
            continue
        session_dict = s.model_dump()
        session_dict["nickname"] = meta.get("nickname")
        result.append(session_dict)

    return result[:limit]


@router.get("/session/{session_id}")
async def get_session(session_id: str):
    """Get full conversation history for a session."""
    # Check if session is deleted
    if db.is_session_deleted(session_id):
        raise HTTPException(status_code=404, detail="Session is in recycle bin")

    messages = get_session_messages(session_id)
    meta = db.get_session_metadata(session_id)

    return {
        "session_id": session_id,
        "nickname": meta.get("nickname") if meta else None,
        "messages": [m.model_dump() for m in messages],
        "count": len(messages)
    }


@router.put("/session/{session_id}")
async def update_session(session_id: str, update: SessionUpdate):
    """Update session metadata (nickname)."""
    active_project = db.get_active_project()
    project_id = active_project["id"] if active_project else None

    meta = db.upsert_session_metadata(
        session_id,
        project_id=project_id,
        nickname=update.nickname
    )
    return meta


@router.delete("/session/{session_id}")
async def delete_session(session_id: str):
    """Soft delete a session (move to recycle bin)."""
    active_project = db.get_active_project()
    project_id = active_project["id"] if active_project else None
    db.soft_delete_session(session_id, project_id)
    return {"status": "deleted", "session_id": session_id}


@router.post("/session/{session_id}/restore")
async def restore_session_endpoint(session_id: str):
    """Restore a session from recycle bin."""
    if db.restore_session(session_id):
        return {"status": "restored", "session_id": session_id}
    raise HTTPException(status_code=404, detail="Session not found in recycle bin")


@router.delete("/session/{session_id}/permanent")
async def permanently_delete_session(session_id: str):
    """Permanently delete a session from recycle bin."""
    if db.permanently_delete_session(session_id):
        return {"status": "permanently_deleted", "session_id": session_id}
    raise HTTPException(status_code=404, detail="Session not found")
