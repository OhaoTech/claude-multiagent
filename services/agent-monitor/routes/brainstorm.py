"""Brainstorm endpoints for Phase 5 autonomous agent company."""

import subprocess
from pathlib import Path
from typing import Optional

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import database as db
from services.websocket import manager

router = APIRouter(prefix="/api/projects/{project_id}/brainstorm", tags=["brainstorm"])


class BrainstormRequest(BaseModel):
    """Request to brainstorm project structure."""
    description: str
    constraints: Optional[list[str]] = None


class AgentPlan(BaseModel):
    """Planned agent configuration."""
    name: str
    domain: str
    responsibilities: list[str]


class SprintTask(BaseModel):
    """Task for the first sprint."""
    title: str
    description: str
    agent: str
    priority: int = 1


class CompanyPlan(BaseModel):
    """Full company plan generated from brainstorm."""
    project_name: str
    description: str
    agents: list[AgentPlan]
    first_sprint: list[SprintTask]
    architecture_notes: Optional[str] = None


class BrainstormResponse(BaseModel):
    """Response from brainstorm endpoint."""
    plan_id: str
    plan: CompanyPlan
    status: str = "pending"


@router.post("", response_model=BrainstormResponse)
async def brainstorm_project(project_id: str, request: BrainstormRequest):
    """
    Brainstorm and generate a company plan for a project.

    This endpoint analyzes the project description and generates:
    - Recommended agent structure
    - Domain assignments
    - First sprint tasks

    The plan must be approved before agents are created.
    """
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Generate plan based on description
    plan = generate_basic_plan(project["name"], request.description, request.constraints)

    # Store in database
    db_plan = db.create_company_plan(
        project_id=project_id,
        description=request.description,
        agents=[a.model_dump() for a in plan.agents],
        first_sprint=[t.model_dump() for t in plan.first_sprint],
        architecture_notes=plan.architecture_notes
    )

    await manager.broadcast({
        "type": "plan_created",
        "data": {"plan_id": db_plan["id"], "project_id": project_id}
    })

    return BrainstormResponse(
        plan_id=db_plan["id"],
        plan=plan,
        status="pending"
    )


@router.post("/{plan_id}/approve")
async def approve_plan(project_id: str, plan_id: str):
    """
    Approve a brainstorm plan and create agents/tasks.

    This will:
    1. Create git worktrees for each agent
    2. Register agents in the database
    3. Create the first sprint with planned tasks
    """
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    plan = db.get_company_plan(plan_id)
    if not plan or plan["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Plan not found")

    if plan["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Plan already {plan['status']}")

    project_root = Path(project["root_path"])
    parent_dir = project_root.parent

    # Check if project is a git repository
    if not (project_root / ".git").exists():
        raise HTTPException(status_code=400, detail="Project is not a git repository")

    created_agents = []
    errors = []

    # Create agents and worktrees
    for agent_plan in plan["agents"]:
        name = agent_plan["name"]
        domain = agent_plan["domain"]

        # Skip leader - already exists or will be main project
        if name == "leader":
            # Check if leader exists, if not create it
            existing_leader = db.get_agent_by_name(project_id, "leader")
            if not existing_leader:
                leader = db.create_agent(
                    project_id=project_id,
                    name="leader",
                    domain=".",
                    worktree_path=str(project_root),
                    is_leader=True
                )
                created_agents.append({"name": "leader", "id": leader["id"], "worktree": str(project_root)})
            continue

        # Check if agent already exists
        existing = db.get_agent_by_name(project_id, name)
        if existing:
            errors.append(f"Agent '{name}' already exists")
            continue

        # Create worktree
        worktree_path = parent_dir / f"{project_root.name}-{name}"

        try:
            result = subprocess.run(
                ["git", "worktree", "add", "--detach", str(worktree_path), "HEAD"],
                cwd=str(project_root),
                capture_output=True,
                text=True
            )
            if result.returncode != 0 and "already exists" not in result.stderr:
                errors.append(f"Failed to create worktree for {name}: {result.stderr}")
                continue
        except Exception as e:
            errors.append(f"Error creating worktree for {name}: {e}")
            continue

        # Create agent in database
        agent = db.create_agent(
            project_id=project_id,
            name=name,
            domain=domain,
            worktree_path=str(worktree_path)
        )
        created_agents.append({
            "name": name,
            "id": agent["id"],
            "worktree": str(worktree_path),
            "domain": domain
        })

    # Create agents.yaml config file for dispatch.sh
    agents_yaml_path = project_root / ".claude" / "agents.yaml"
    agents_yaml_path.parent.mkdir(parents=True, exist_ok=True)

    agents_config = {"agents": {}}
    for agent_info in created_agents:
        if agent_info["name"] != "leader":  # Leader uses main repo
            agents_config["agents"][agent_info["name"]] = {
                "worktree": f"{project_root.name}-{agent_info['name']}",
                "domain": agent_info["domain"]
            }

    with open(agents_yaml_path, "w") as f:
        yaml.dump(agents_config, f, default_flow_style=False)

    # Create first sprint
    sprint = db.create_sprint(
        project_id=project_id,
        name="Sprint 1 - Initial Setup",
        goal="Set up project structure and initial functionality"
    )

    # Create tasks from plan
    created_tasks = []
    for task_plan in plan["first_sprint"]:
        # Find agent ID by name
        agent_id = None
        agent_name = task_plan["agent"]
        agent = db.get_agent_by_name(project_id, agent_name)
        if agent:
            agent_id = agent["id"]

        task = db.create_task(
            project_id=project_id,
            title=task_plan["title"],
            description=task_plan["description"],
            agent_id=agent_id,
            sprint_id=sprint["id"],
            priority=task_plan.get("priority", 1)
        )
        created_tasks.append({"id": task["id"], "title": task["title"]})

    # Mark plan as approved
    db.approve_company_plan(plan_id)

    await manager.broadcast({
        "type": "plan_approved",
        "data": {
            "plan_id": plan_id,
            "agents_created": len(created_agents),
            "tasks_created": len(created_tasks)
        }
    })

    return {
        "status": "approved",
        "agents": created_agents,
        "sprint": {"id": sprint["id"], "name": sprint["name"]},
        "tasks": created_tasks,
        "errors": errors if errors else None
    }


@router.get("/plans")
async def list_plans(project_id: str, status: Optional[str] = None):
    """List all brainstorm plans for a project."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    plans = db.list_company_plans(project_id, status=status)
    return {"plans": plans}


@router.get("/{plan_id}")
async def get_plan(project_id: str, plan_id: str):
    """Get a specific brainstorm plan."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    plan = db.get_company_plan(plan_id)
    if not plan or plan["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Plan not found")

    return plan


@router.delete("/{plan_id}")
async def delete_plan(project_id: str, plan_id: str):
    """Delete a brainstorm plan (only if pending)."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    plan = db.get_company_plan(plan_id)
    if not plan or plan["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Plan not found")

    if plan["status"] != "pending":
        raise HTTPException(status_code=400, detail="Can only delete pending plans")

    db.delete_company_plan(plan_id)
    return {"status": "deleted"}


def generate_basic_plan(
    project_name: str,
    description: str,
    constraints: Optional[list[str]] = None
) -> CompanyPlan:
    """
    Generate a basic company plan from project description.

    This is a heuristic-based generator. For more sophisticated plans,
    the leader agent can be invoked via brainstorm.sh skill.
    """
    desc_lower = description.lower()

    agents = [
        AgentPlan(
            name="leader",
            domain=".",
            responsibilities=[
                "Coordinate work across all agents",
                "Review and merge changes",
                "Handle cross-cutting concerns"
            ]
        )
    ]

    # Detect common patterns and suggest agents
    if any(kw in desc_lower for kw in ["api", "backend", "server", "endpoint", "rest", "graphql"]):
        agents.append(AgentPlan(
            name="api",
            domain="services/api" if "services" in desc_lower else "api",
            responsibilities=[
                "Implement API endpoints",
                "Handle data validation",
                "Manage database interactions"
            ]
        ))

    if any(kw in desc_lower for kw in ["frontend", "web", "ui", "react", "vue", "dashboard"]):
        agents.append(AgentPlan(
            name="web",
            domain="apps/web" if "apps" in desc_lower else "web",
            responsibilities=[
                "Build user interface components",
                "Handle state management",
                "Implement user interactions"
            ]
        ))

    if any(kw in desc_lower for kw in ["mobile", "ios", "android", "app", "native"]):
        agents.append(AgentPlan(
            name="mobile",
            domain="apps/mobile" if "apps" in desc_lower else "mobile",
            responsibilities=[
                "Build mobile app screens",
                "Handle native integrations",
                "Manage mobile-specific state"
            ]
        ))

    if any(kw in desc_lower for kw in ["admin", "dashboard", "management", "cms"]):
        agents.append(AgentPlan(
            name="admin",
            domain="apps/admin" if "apps" in desc_lower else "admin",
            responsibilities=[
                "Build admin interface",
                "Implement management features",
                "Handle admin authentication"
            ]
        ))

    # If no specific agents detected, add generic dev agent
    if len(agents) == 1:
        agents.extend([
            AgentPlan(
                name="dev",
                domain="src",
                responsibilities=[
                    "Implement core functionality",
                    "Write unit tests",
                    "Maintain code quality"
                ]
            )
        ])

    # Generate first sprint tasks
    first_sprint = [
        SprintTask(
            title="Set up project structure",
            description="Create initial folder structure and configuration files",
            agent="leader",
            priority=1
        ),
        SprintTask(
            title="Initialize development environment",
            description="Set up dependencies, linting, and build tools",
            agent="leader",
            priority=1
        )
    ]

    # Add domain-specific setup tasks
    for agent in agents[1:]:
        first_sprint.append(SprintTask(
            title=f"Set up {agent.name} domain",
            description=f"Initialize {agent.domain}/ with basic structure and configuration",
            agent=agent.name,
            priority=2
        ))

    # Add feature tasks based on description
    if "auth" in desc_lower or "login" in desc_lower:
        first_sprint.append(SprintTask(
            title="Implement authentication",
            description="Set up user authentication (login, register, JWT)",
            agent="api" if any(a.name == "api" for a in agents) else "dev",
            priority=2
        ))

    if "database" in desc_lower or "data" in desc_lower:
        first_sprint.append(SprintTask(
            title="Set up database schema",
            description="Design and implement initial database models",
            agent="api" if any(a.name == "api" for a in agents) else "dev",
            priority=2
        ))

    return CompanyPlan(
        project_name=project_name,
        description=description,
        agents=agents,
        first_sprint=first_sprint,
        architecture_notes=f"Auto-generated plan for '{project_name}'. Customize agents and tasks as needed before approving."
    )
