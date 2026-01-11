"""State and health endpoints."""

import json
import time
from pathlib import Path

from fastapi import APIRouter

from config import AGENT_MAIL_PATH, RESULTS_PATH
from models import AgentInfo, AgentState
import database as db

router = APIRouter()


@router.get("/health")
async def health():
    """Health check endpoint."""
    from services.websocket import manager
    return {
        "status": "ok",
        "service": "agent-monitor",
        "watching": str(AGENT_MAIL_PATH),
        "connections": len(manager.active_connections)
    }


@router.get("/api/state")
async def get_state() -> AgentState:
    """Get current agent orchestration state."""
    state_file = AGENT_MAIL_PATH / "state.json"
    if state_file.exists():
        data = json.loads(state_file.read_text())
        return AgentState(**data)
    return AgentState()


@router.get("/api/agents")
async def get_agents() -> list[AgentInfo]:
    """Get list of all agents with their status from the active project."""
    active_project = db.get_active_project()
    if not active_project:
        return []

    db_agents = db.list_agents(active_project["id"])
    agents = []

    for agent_data in db_agents:
        name = agent_data["name"]
        result_dir = RESULTS_PATH / name
        result_count = 0
        last_result = None

        if result_dir.exists():
            result_files = sorted(result_dir.glob("*-output.json"), reverse=True)
            result_count = len(result_files)

            if result_files:
                try:
                    data = json.loads(result_files[0].read_text())
                    last_result = {
                        "agent": name,
                        "status": "success" if not data.get("is_error") else "failed",
                        "cost_usd": data.get("total_cost_usd"),
                        "duration_ms": data.get("duration_ms"),
                        "timestamp": int(result_files[0].stem.split("-")[0])
                    }
                except Exception:
                    pass

        worktree_path = agent_data.get("worktree_path", "")
        worktree = Path(worktree_path).name if worktree_path else name

        agents.append(AgentInfo(
            name=name,
            domain=agent_data["domain"],
            worktree=worktree,
            last_result=last_result,
            result_count=result_count
        ))

    return agents


@router.get("/api/results/{agent}")
async def get_results(agent: str, limit: int = 10):
    """Get recent results for an agent."""
    result_dir = RESULTS_PATH / agent
    if not result_dir.exists():
        return {"results": []}

    results = []
    output_files = sorted(result_dir.glob("*-output.json"), reverse=True)[:limit]

    for output_file in output_files:
        try:
            data = json.loads(output_file.read_text())
            results.append({
                "file": output_file.name,
                "timestamp": int(output_file.stem.split("-")[0]),
                "is_error": data.get("is_error", False),
                "duration_ms": data.get("duration_ms"),
                "num_turns": data.get("num_turns"),
                "cost_usd": data.get("total_cost_usd"),
                "result_preview": data.get("result", "")[:200]
            })
        except Exception:
            pass

    return {"results": results}
