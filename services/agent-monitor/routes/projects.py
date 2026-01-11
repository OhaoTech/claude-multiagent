"""Project CRUD endpoints."""

import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException

from models import ProjectCreate, ProjectUpdate, ProjectResponse
from services.skills import install_skill
from config import DEFAULT_SKILLS, update_paths
import database as db

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[ProjectResponse])
async def list_projects():
    """List all projects."""
    projects = db.list_projects()
    return [ProjectResponse(**p) for p in projects]


@router.get("/active", response_model=ProjectResponse)
async def get_active_project():
    """Get the currently active project."""
    project = db.get_active_project()
    if not project:
        raise HTTPException(status_code=404, detail="No active project")
    return ProjectResponse(**project)


@router.post("", response_model=ProjectResponse)
async def create_project(request: ProjectCreate):
    """Create a new project with a default leader agent."""
    root_path = Path(request.root_path)
    if not root_path.exists():
        raise HTTPException(status_code=400, detail=f"Path does not exist: {request.root_path}")

    existing = db.get_project_by_path(request.root_path)
    if existing:
        raise HTTPException(status_code=400, detail="Project with this path already exists")

    # Check if it's a git repo, init if requested
    is_git_repo = (root_path / ".git").exists()
    if not is_git_repo:
        if request.init_git:
            try:
                subprocess.run(
                    ["git", "init"],
                    cwd=str(root_path),
                    check=True,
                    capture_output=True,
                )
            except subprocess.CalledProcessError as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to initialize git repository: {e.stderr.decode() if e.stderr else str(e)}"
                )
        else:
            raise HTTPException(
                status_code=400,
                detail="Selected directory is not a git repository. Enable 'Initialize git repository' to create one."
            )

    project = db.create_project(request.name, request.root_path, request.description)

    project_root = Path(request.root_path)
    for skill_id in DEFAULT_SKILLS:
        try:
            install_skill(project_root, skill_id)
        except Exception as e:
            print(f"Warning: Failed to install skill {skill_id}: {e}")

    return ProjectResponse(**project)


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str):
    """Get a project by ID."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectResponse(**project)


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(project_id: str, request: ProjectUpdate):
    """Update a project."""
    updates = request.model_dump(exclude_unset=True)
    project = db.update_project(project_id, **updates)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectResponse(**project)


@router.delete("/{project_id}")
async def delete_project(project_id: str):
    """Delete a project and its agents."""
    success = db.delete_project(project_id)
    if not success:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"success": True}


@router.post("/{project_id}/select", response_model=ProjectResponse)
async def select_project(project_id: str):
    """Set a project as the active project."""
    project = db.set_active_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    update_paths(Path(project["root_path"]))
    return ProjectResponse(**project)


@router.get("/{project_id}/team-state")
async def get_team_state(project_id: str):
    """Get team state from .claude/team-state.yaml."""
    import yaml

    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    state_file = Path(project["root_path"]) / ".claude" / "team-state.yaml"

    if not state_file.exists():
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


@router.delete("/{project_id}/team-state/agents/{agent_name}")
async def remove_team_state_agent(project_id: str, agent_name: str):
    """Remove an agent from team-state.yaml (cleanup stale entries)."""
    import yaml

    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    state_file = Path(project["root_path"]) / ".claude" / "team-state.yaml"

    if not state_file.exists():
        raise HTTPException(status_code=404, detail="Team state file not found")

    try:
        state = yaml.safe_load(state_file.read_text())

        if "agents" not in state or agent_name not in state["agents"]:
            raise HTTPException(status_code=404, detail=f"Agent '{agent_name}' not found in team state")

        # Remove the agent
        del state["agents"][agent_name]

        # Write back
        with open(state_file, "w") as f:
            yaml.dump(state, f, default_flow_style=False, sort_keys=False)

        return {"success": True, "removed": agent_name}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update team state: {e}")
