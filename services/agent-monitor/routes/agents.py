"""Agent management endpoints (per project)."""

import subprocess
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException

from models import AgentCreate, AgentUpdate, AgentResponse
import database as db

router = APIRouter(prefix="/api/projects/{project_id}/agents", tags=["agents"])


@router.get("", response_model=list[AgentResponse])
async def list_project_agents(project_id: str):
    """List all agents for a project."""
    agents = db.list_agents(project_id)
    return [AgentResponse(**a) for a in agents]


@router.post("", response_model=AgentResponse)
async def create_agent(project_id: str, request: AgentCreate):
    """Create a new agent for a project."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    existing = db.get_agent_by_name(project_id, request.name)
    if existing:
        raise HTTPException(status_code=400, detail=f"Agent '{request.name}' already exists")

    project_root = Path(project["root_path"])
    parent_dir = project_root.parent
    worktree_path = parent_dir / f"{project_root.name}-{request.name}"

    git_dir = project_root / ".git"
    if not git_dir.exists():
        raise HTTPException(status_code=400, detail="Project is not a git repository")

    try:
        result = subprocess.run(
            ["git", "worktree", "add", "--detach", str(worktree_path), "HEAD"],
            cwd=str(project_root),
            capture_output=True,
            text=True
        )
        if result.returncode != 0:
            if "already exists" not in result.stderr:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to create git worktree: {result.stderr}"
                )
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="git command not found")

    agent = db.create_agent(project_id, request.name, request.domain, str(worktree_path))

    # Create AGENTS.md in the domain folder
    try:
        domain_path = project_root / request.domain
        if domain_path.exists() and domain_path.is_dir():
            agents_md = domain_path / "AGENTS.md"
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
            if not agents_md.exists():
                with open(agents_md, "w") as f:
                    f.write(content)
    except Exception as e:
        print(f"Warning: Failed to create AGENTS.md: {e}")

    return AgentResponse(**agent)


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent(project_id: str, agent_id: str):
    """Get an agent by ID."""
    agent = db.get_agent(agent_id)
    if not agent or agent["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Agent not found")
    return AgentResponse(**agent)


@router.put("/{agent_id}", response_model=AgentResponse)
async def update_agent(project_id: str, agent_id: str, request: AgentUpdate):
    """Update an agent."""
    agent = db.get_agent(agent_id)
    if not agent or agent["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Agent not found")

    updates = request.model_dump(exclude_unset=True)
    agent = db.update_agent(agent_id, **updates)
    return AgentResponse(**agent)


@router.delete("/{agent_id}")
async def delete_agent(project_id: str, agent_id: str, remove_worktree: bool = True):
    """Delete an agent. Optionally remove the git worktree as well."""
    agent = db.get_agent(agent_id)
    if not agent or agent["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Agent not found")

    if agent["is_leader"]:
        raise HTTPException(status_code=400, detail="Cannot delete leader agent. Set another agent as leader first.")

    project = db.get_project(project_id)
    worktree_path = agent.get("worktree_path")

    # Only remove worktree if requested
    if remove_worktree and worktree_path and project:
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
            pass
        except Exception as e:
            print(f"Warning: Error removing worktree: {e}")

    success = db.delete_agent(agent_id)
    return {"success": success, "worktree_removed": remove_worktree}


@router.post("/{agent_id}/set-leader")
async def set_agent_as_leader(project_id: str, agent_id: str):
    """Set this agent as the project leader."""
    agent = db.get_agent(agent_id)
    if not agent or agent["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Agent not found")

    updated = db.set_leader(project_id, agent_id)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to set leader")

    return AgentResponse(**updated)


@router.post("/{agent_id}/history")
async def get_agent_task_history(project_id: str, agent_id: str, limit: int = 20):
    """Get recent task history for an agent."""
    agent = db.get_agent(agent_id)
    if not agent or agent["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Agent not found")

    return db.get_agent_task_history(agent_id, limit)


@router.get("/{agent_id}/git-status")
async def get_agent_git_status(project_id: str, agent_id: str):
    """Get git status for an agent's worktree."""
    agent = db.get_agent(agent_id)
    if not agent or agent["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Agent not found")

    worktree_path = agent.get("worktree_path")
    if not worktree_path or not Path(worktree_path).exists():
        return {"error": "No worktree", "worktree_path": worktree_path}

    try:
        # Get branch info
        branch_result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=worktree_path,
            capture_output=True,
            text=True
        )
        branch = branch_result.stdout.strip() if branch_result.returncode == 0 else "HEAD"

        # Get short status
        status_result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=worktree_path,
            capture_output=True,
            text=True
        )
        status_lines = status_result.stdout.strip().split("\n") if status_result.stdout.strip() else []

        # Count changes
        modified = len([l for l in status_lines if l and l[0] in "M "])
        added = len([l for l in status_lines if l and l[0] in "A?"])
        deleted = len([l for l in status_lines if l and l[0] in "D"])
        untracked = len([l for l in status_lines if l.startswith("??")])

        # Check ahead/behind
        ahead_behind = subprocess.run(
            ["git", "rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
            cwd=worktree_path,
            capture_output=True,
            text=True
        )
        ahead = behind = 0
        if ahead_behind.returncode == 0 and ahead_behind.stdout.strip():
            parts = ahead_behind.stdout.strip().split()
            if len(parts) == 2:
                ahead, behind = int(parts[0]), int(parts[1])

        return {
            "branch": branch,
            "modified": modified,
            "added": added,
            "deleted": deleted,
            "untracked": untracked,
            "ahead": ahead,
            "behind": behind,
            "clean": len(status_lines) == 0,
            "worktree_path": worktree_path
        }
    except Exception as e:
        return {"error": str(e), "worktree_path": worktree_path}


# Note: sync_worktrees is registered at project level in app.py
async def sync_worktrees(project_id: str):
    """Detect existing git worktrees and register them as agents."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project_root = Path(project["root_path"])
    project_name = project_root.name

    if not (project_root / ".git").exists():
        raise HTTPException(status_code=400, detail="Project is not a git repository")

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

    existing_agents = db.list_agents(project_id)
    existing_paths = {a["worktree_path"] for a in existing_agents if a["worktree_path"]}

    created = []
    skipped = []

    for wt in worktrees:
        wt_path = wt["path"]

        if wt_path == str(project_root):
            continue

        if wt_path in existing_paths:
            skipped.append(wt_path)
            continue

        folder_name = Path(wt_path).name
        if folder_name.startswith(f"{project_name}-"):
            agent_name = folder_name[len(project_name) + 1:]
        else:
            agent_name = folder_name

        if db.get_agent_by_name(project_id, agent_name):
            agent_name = f"{agent_name}-wt"

        domain = agent_name
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
