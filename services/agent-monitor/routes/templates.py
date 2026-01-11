"""Task template endpoints."""

from fastapi import APIRouter, HTTPException

from models import (
    TaskTemplateCreate, TaskTemplateUpdate, TaskTemplateResponse,
    CreateFromTemplateRequest, TaskResponse
)
from services.websocket import manager
import database as db

router = APIRouter(prefix="/api/projects/{project_id}/templates", tags=["templates"])


@router.get("", response_model=list[TaskTemplateResponse])
async def list_task_templates(project_id: str):
    """List all task templates for a project."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    templates = db.list_task_templates(project_id)
    return [TaskTemplateResponse(**t) for t in templates]


@router.post("", response_model=TaskTemplateResponse)
async def create_task_template(project_id: str, request: TaskTemplateCreate):
    """Create a new task template."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    template = db.create_task_template(
        project_id=project_id,
        name=request.name,
        title=request.title,
        description=request.description,
        priority=request.priority,
        agent_id=request.agent_id
    )

    return TaskTemplateResponse(**template)


@router.get("/{template_id}", response_model=TaskTemplateResponse)
async def get_task_template(project_id: str, template_id: str):
    """Get a specific task template."""
    template = db.get_task_template(template_id)
    if not template or template["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Template not found")

    return TaskTemplateResponse(**template)


@router.put("/{template_id}", response_model=TaskTemplateResponse)
async def update_task_template(project_id: str, template_id: str, request: TaskTemplateUpdate):
    """Update a task template."""
    template = db.get_task_template(template_id)
    if not template or template["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Template not found")

    updates = request.model_dump(exclude_unset=True)
    updated = db.update_task_template(template_id, **updates)

    return TaskTemplateResponse(**updated)


@router.delete("/{template_id}")
async def delete_task_template(project_id: str, template_id: str):
    """Delete a task template."""
    template = db.get_task_template(template_id)
    if not template or template["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Template not found")

    db.delete_task_template(template_id)
    return {"status": "deleted"}


@router.post("/{template_id}/create-task", response_model=TaskResponse)
async def create_task_from_template(project_id: str, template_id: str, request: CreateFromTemplateRequest):
    """Create a new task from a template."""
    template = db.get_task_template(template_id)
    if not template or template["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Template not found")

    task = db.create_task_from_template(template_id, sprint_id=request.sprint_id)
    if not task:
        raise HTTPException(status_code=500, detail="Failed to create task from template")

    await manager.broadcast({
        "type": "task_created",
        "data": {"task_id": task["id"]}
    })

    return TaskResponse(**task)
