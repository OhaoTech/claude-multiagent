"""Sprint planning endpoints."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException

from models import SprintCreate, SprintUpdate, SprintResponse, SprintStats
from services.websocket import manager
import database as db

router = APIRouter(prefix="/api/projects/{project_id}/sprints", tags=["sprints"])


@router.get("", response_model=list[SprintResponse])
async def list_sprints(project_id: str, status: Optional[str] = None):
    """List all sprints for a project."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    sprints = db.list_sprints(project_id, status=status)
    return [SprintResponse(**s) for s in sprints]


@router.post("", response_model=SprintResponse)
async def create_sprint(project_id: str, request: SprintCreate):
    """Create a new sprint."""
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


@router.get("/{sprint_id}", response_model=SprintResponse)
async def get_sprint(project_id: str, sprint_id: str):
    """Get a sprint by ID."""
    sprint = db.get_sprint(sprint_id)
    if not sprint or sprint["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Sprint not found")

    return SprintResponse(**sprint)


@router.put("/{sprint_id}", response_model=SprintResponse)
async def update_sprint(project_id: str, sprint_id: str, request: SprintUpdate):
    """Update a sprint."""
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


@router.delete("/{sprint_id}")
async def delete_sprint(project_id: str, sprint_id: str):
    """Delete a sprint (tasks remain but lose sprint assignment)."""
    sprint = db.get_sprint(sprint_id)
    if not sprint or sprint["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Sprint not found")

    db.delete_sprint(sprint_id)

    await manager.broadcast({
        "type": "sprint_deleted",
        "data": {"sprint_id": sprint_id}
    })

    return {"status": "deleted"}


@router.get("/{sprint_id}/stats", response_model=SprintStats)
async def get_sprint_stats(project_id: str, sprint_id: str):
    """Get task statistics for a sprint."""
    sprint = db.get_sprint(sprint_id)
    if not sprint or sprint["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Sprint not found")

    stats = db.get_sprint_stats(sprint_id)

    completion = 0.0
    if stats["total"] > 0:
        completion = (stats["completed"] / stats["total"]) * 100

    return SprintStats(**stats, completion_percent=round(completion, 1))


@router.post("/{sprint_id}/start")
async def start_sprint(project_id: str, sprint_id: str):
    """Start a sprint (set status to active)."""
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


@router.post("/{sprint_id}/complete")
async def complete_sprint(project_id: str, sprint_id: str):
    """Complete a sprint."""
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


@router.get("/{sprint_id}/burndown")
async def get_sprint_burndown(project_id: str, sprint_id: str):
    """Get burndown data for a sprint."""
    sprint = db.get_sprint(sprint_id)
    if not sprint or sprint["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Sprint not found")

    return db.get_sprint_burndown(sprint_id)


# Note: get_velocity is registered at project level in app.py
async def get_velocity(project_id: str, limit: int = 10):
    """Get velocity data for completed sprints."""
    return db.get_velocity_data(project_id, limit)
