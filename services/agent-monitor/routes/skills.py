"""Skills endpoints."""

from pathlib import Path

from fastapi import APIRouter, HTTPException

from services.skills import (
    get_available_skills,
    get_installed_skills,
    install_skill,
    uninstall_skill
)
import database as db

router = APIRouter(tags=["skills"])


@router.get("/api/skills")
async def list_available_skills():
    """List all available skills that can be installed."""
    return {"skills": get_available_skills()}


@router.get("/api/projects/{project_id}/skills")
async def list_project_skills(project_id: str):
    """List installed skills for a project."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project_root = Path(project["root_path"])
    installed = get_installed_skills(project_root)
    available = get_available_skills()

    installed_ids = {s["id"] for s in installed}
    for skill in available:
        skill["installed"] = skill["id"] in installed_ids

    return {
        "installed": installed,
        "available": available,
    }


@router.post("/api/projects/{project_id}/skills/{skill_id}")
async def install_project_skill(project_id: str, skill_id: str):
    """Install a skill to a project."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    available = get_available_skills()
    if not any(s["id"] == skill_id for s in available):
        raise HTTPException(status_code=404, detail=f"Skill not found: {skill_id}")

    project_root = Path(project["root_path"])
    success = install_skill(project_root, skill_id)

    if not success:
        raise HTTPException(status_code=500, detail="Failed to install skill")

    return {"success": True, "skill_id": skill_id}


@router.delete("/api/projects/{project_id}/skills/{skill_id}")
async def uninstall_project_skill(project_id: str, skill_id: str):
    """Uninstall a skill from a project."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project_root = Path(project["root_path"])
    success = uninstall_skill(project_root, skill_id)

    if not success:
        raise HTTPException(status_code=404, detail=f"Skill not installed: {skill_id}")

    return {"success": True, "skill_id": skill_id}
