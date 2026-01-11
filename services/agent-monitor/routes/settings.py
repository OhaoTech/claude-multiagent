"""Settings endpoints."""

from fastapi import APIRouter, HTTPException

from models import (
    SettingsResponse, SettingsUpdate,
    ProjectSettingsResponse, ProjectSettingsUpdate
)
import database as db

router = APIRouter(tags=["settings"])


@router.get("/api/settings", response_model=SettingsResponse)
async def get_settings():
    """Get global settings."""
    settings = db.get_settings()
    return SettingsResponse(**settings)


@router.put("/api/settings", response_model=SettingsResponse)
async def update_settings(request: SettingsUpdate):
    """Update global settings."""
    updates = request.model_dump(exclude_unset=True)
    settings = db.update_settings(**updates)
    return SettingsResponse(**settings)


@router.get("/api/projects/{project_id}/settings", response_model=ProjectSettingsResponse)
async def get_project_settings(project_id: str):
    """Get project-specific settings."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    settings = db.get_project_settings(project_id)
    return ProjectSettingsResponse(**settings)


@router.put("/api/projects/{project_id}/settings", response_model=ProjectSettingsResponse)
async def update_project_settings(project_id: str, request: ProjectSettingsUpdate):
    """Update project-specific settings."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    updates = request.model_dump(exclude_unset=True)
    settings = db.update_project_settings(project_id, **updates)
    return ProjectSettingsResponse(**settings)
