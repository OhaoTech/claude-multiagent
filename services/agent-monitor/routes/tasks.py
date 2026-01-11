"""Task queue endpoints."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException

from models import TaskCreate, TaskUpdate, TaskResponse, TaskAssign, QueueStats
from services.websocket import manager
from scheduler import get_scheduler
import database as db

router = APIRouter(prefix="/api/projects/{project_id}/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskResponse])
async def list_tasks(
    project_id: str,
    status: Optional[str] = None,
    agent_id: Optional[str] = None,
    sprint_id: Optional[str] = None
):
    """List tasks for a project with optional filters."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    tasks = db.list_tasks(project_id, status=status, agent_id=agent_id, sprint_id=sprint_id)
    return [TaskResponse(**t) for t in tasks]


@router.post("", response_model=TaskResponse)
async def create_task(project_id: str, request: TaskCreate):
    """Create a new task in the queue."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if request.agent_id:
        agent = db.get_agent(request.agent_id)
        if not agent or agent["project_id"] != project_id:
            raise HTTPException(status_code=400, detail="Invalid agent_id")

    if request.sprint_id:
        sprint = db.get_sprint(request.sprint_id)
        if not sprint or sprint["project_id"] != project_id:
            raise HTTPException(status_code=400, detail="Invalid sprint_id")

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

    await manager.broadcast({
        "type": "task_created",
        "data": {"task_id": task["id"], "title": task["title"]}
    })

    return TaskResponse(**task)


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(project_id: str, task_id: str):
    """Get a task by ID."""
    task = db.get_task(task_id)
    if not task or task["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Task not found")

    return TaskResponse(**task)


@router.put("/{task_id}", response_model=TaskResponse)
async def update_task(project_id: str, task_id: str, request: TaskUpdate):
    """Update a task."""
    task = db.get_task(task_id)
    if not task or task["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Task not found")

    updates = request.model_dump(exclude_unset=True)

    if "agent_id" in updates and updates["agent_id"]:
        agent = db.get_agent(updates["agent_id"])
        if not agent or agent["project_id"] != project_id:
            raise HTTPException(status_code=400, detail="Invalid agent_id")

    task = db.update_task(task_id, **updates)
    return TaskResponse(**task)


@router.delete("/{task_id}")
async def delete_task(project_id: str, task_id: str):
    """Delete a task."""
    task = db.get_task(task_id)
    if not task or task["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Task not found")

    if task["status"] == "running":
        raise HTTPException(status_code=400, detail="Cannot delete running task")

    success = db.delete_task(task_id)
    return {"success": success}


@router.post("/{task_id}/assign", response_model=TaskResponse)
async def assign_task(project_id: str, task_id: str, request: TaskAssign):
    """Manually assign a task to an agent."""
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


@router.post("/{task_id}/retry", response_model=TaskResponse)
async def retry_task(project_id: str, task_id: str):
    """Retry a failed task."""
    task = db.get_task(task_id)
    if not task or task["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Task not found")

    if task["status"] != "failed":
        raise HTTPException(status_code=400, detail="Can only retry failed tasks")

    scheduler = get_scheduler()
    if scheduler:
        await scheduler.retry_task(task_id)
    else:
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


@router.post("/{task_id}/cancel")
async def cancel_task(project_id: str, task_id: str):
    """Cancel a running task."""
    task = db.get_task(task_id)
    if not task or task["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Task not found")

    if task["status"] != "running":
        raise HTTPException(status_code=400, detail="Can only cancel running tasks")

    scheduler = get_scheduler()
    if scheduler:
        success = await scheduler.cancel_task(task_id)
    else:
        db.update_task(
            task_id,
            status="failed",
            completed_at=datetime.utcnow().isoformat(),
            error="Cancelled by user"
        )
        success = True

    return {"success": success}


@router.post("/{task_id}/breakdown")
async def breakdown_task(project_id: str, task_id: str):
    """
    Break down a task into subtasks (Phase 5B).

    This analyzes the task title/description and generates subtasks
    with appropriate dependencies.
    """
    task = db.get_task(task_id)
    if not task or task["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Task not found")

    if task["status"] not in ("pending", "blocked"):
        raise HTTPException(status_code=400, detail="Can only break down pending/blocked tasks")

    # Get agents for this project
    agents = db.list_agents(project_id)
    agent_names = {a["name"]: a["id"] for a in agents}

    # Generate subtasks based on task content
    subtasks = generate_subtasks(
        task["title"],
        task.get("description", ""),
        agent_names
    )

    if not subtasks:
        return {"status": "no_breakdown", "message": "Task is already atomic"}

    created_subtasks = []
    prev_task_id = None

    for i, subtask in enumerate(subtasks):
        # Determine dependencies
        depends_on = []
        if subtask.get("depends_on_previous") and prev_task_id:
            depends_on = [prev_task_id]

        new_task = db.create_task(
            project_id=project_id,
            title=subtask["title"],
            description=subtask.get("description"),
            agent_id=subtask.get("agent_id"),
            sprint_id=task.get("sprint_id"),
            priority=subtask.get("priority", task.get("priority", 1)),
            depends_on=depends_on if depends_on else None
        )
        created_subtasks.append({"id": new_task["id"], "title": new_task["title"]})
        prev_task_id = new_task["id"]

    # Mark original task as completed (replaced by subtasks)
    db.update_task(
        task_id,
        status="completed",
        completed_at=datetime.utcnow().isoformat(),
        result={"breakdown": [t["id"] for t in created_subtasks]}
    )

    await manager.broadcast({
        "type": "task_breakdown",
        "data": {
            "original_task_id": task_id,
            "subtasks": len(created_subtasks)
        }
    })

    return {
        "status": "broken_down",
        "original_task_id": task_id,
        "subtasks": created_subtasks
    }


def generate_subtasks(title: str, description: str, agent_names: dict) -> list[dict]:
    """
    Generate subtasks from a task description.

    This is a heuristic-based breakdown. For more sophisticated
    analysis, the leader agent can be invoked.
    """
    title_lower = title.lower()
    desc_lower = description.lower() if description else ""
    combined = f"{title_lower} {desc_lower}"

    subtasks = []

    # Authentication tasks
    if "auth" in combined or "login" in combined or "register" in combined:
        subtasks = [
            {"title": "Design auth schema", "description": "Define user model and auth tokens", "agent": "api"},
            {"title": "Implement JWT service", "description": "Set up token generation and validation", "agent": "api", "depends_on_previous": True},
            {"title": "Add login endpoint", "description": "POST /auth/login with validation", "agent": "api", "depends_on_previous": True},
            {"title": "Add register endpoint", "description": "POST /auth/register with validation", "agent": "api", "depends_on_previous": True},
            {"title": "Create login UI", "description": "Login form with validation", "agent": "web", "depends_on_previous": True},
            {"title": "Add auth state management", "description": "Store and manage auth tokens", "agent": "web", "depends_on_previous": True},
        ]

    # CRUD operations
    elif "crud" in combined or ("create" in combined and "read" in combined):
        entity = extract_entity(combined)
        subtasks = [
            {"title": f"Design {entity} model", "description": f"Define {entity} schema", "agent": "api"},
            {"title": f"Implement {entity} repository", "description": f"Database operations for {entity}", "agent": "api", "depends_on_previous": True},
            {"title": f"Add {entity} endpoints", "description": f"REST API for {entity} CRUD", "agent": "api", "depends_on_previous": True},
            {"title": f"Create {entity} list view", "description": f"Display {entity} list", "agent": "web", "depends_on_previous": True},
            {"title": f"Create {entity} form", "description": f"Form for creating/editing {entity}", "agent": "web", "depends_on_previous": True},
        ]

    # API endpoint tasks
    elif "api" in combined or "endpoint" in combined:
        subtasks = [
            {"title": "Design API contract", "description": "Define request/response schemas", "agent": "api"},
            {"title": "Implement endpoint handler", "description": "Add route and business logic", "agent": "api", "depends_on_previous": True},
            {"title": "Add validation", "description": "Input validation and error handling", "agent": "api", "depends_on_previous": True},
            {"title": "Write tests", "description": "Unit and integration tests", "agent": "api", "depends_on_previous": True},
        ]

    # UI/Frontend tasks
    elif "ui" in combined or "page" in combined or "component" in combined:
        subtasks = [
            {"title": "Design component structure", "description": "Plan component hierarchy", "agent": "web"},
            {"title": "Create base component", "description": "Implement core UI", "agent": "web", "depends_on_previous": True},
            {"title": "Add styling", "description": "Apply CSS/design system", "agent": "web", "depends_on_previous": True},
            {"title": "Connect to API", "description": "Integrate with backend", "agent": "web", "depends_on_previous": True},
        ]

    # Map agent names to IDs
    for subtask in subtasks:
        agent_name = subtask.pop("agent", None)
        if agent_name and agent_name in agent_names:
            subtask["agent_id"] = agent_names[agent_name]

    return subtasks


def extract_entity(text: str) -> str:
    """Extract the main entity from task description."""
    # Common patterns
    for prefix in ["add ", "create ", "implement ", "build "]:
        if prefix in text:
            after = text.split(prefix, 1)[1]
            words = after.split()
            if words:
                return words[0].rstrip("s")
    return "item"


# Note: get_queue_stats is registered at project level in app.py
async def get_queue_stats(project_id: str):
    """Get task queue statistics."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    stats = db.get_queue_stats(project_id)
    return QueueStats(**stats)
