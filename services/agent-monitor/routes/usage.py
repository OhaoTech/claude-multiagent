"""Usage analytics and performance endpoints."""

import json
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, HTTPException

from models import (
    UsageAnalytics, ModelUsage, DailyActivity,
    AgentPerformance, TaskHistoryItem
)
import database as db

router = APIRouter(tags=["usage"])

# Model pricing (per 1M tokens)
MODEL_PRICING = {
    "claude-opus-4-5-20251101": {
        "input": 15.0,
        "output": 75.0,
        "cache_read": 1.5,
        "cache_creation": 18.75,
    },
    "claude-sonnet-4-5-20250929": {
        "input": 3.0,
        "output": 15.0,
        "cache_read": 0.3,
        "cache_creation": 3.75,
    },
    "claude-opus-4-1-20250805": {
        "input": 15.0,
        "output": 75.0,
        "cache_read": 1.5,
        "cache_creation": 18.75,
    },
}


def calculate_model_cost(model_id: str, usage: dict) -> float:
    """Calculate estimated cost for a model's usage."""
    pricing = MODEL_PRICING.get(model_id)
    if not pricing:
        pricing = MODEL_PRICING["claude-opus-4-5-20251101"]

    input_cost = (usage.get("inputTokens", 0) / 1_000_000) * pricing["input"]
    output_cost = (usage.get("outputTokens", 0) / 1_000_000) * pricing["output"]
    cache_read_cost = (usage.get("cacheReadInputTokens", 0) / 1_000_000) * pricing["cache_read"]
    cache_creation_cost = (usage.get("cacheCreationInputTokens", 0) / 1_000_000) * pricing["cache_creation"]

    return input_cost + output_cost + cache_read_cost + cache_creation_cost


@router.get("/api/usage", response_model=UsageAnalytics)
async def get_usage_analytics(days: int = 30):
    """Get Claude Code usage analytics from stats-cache.json."""
    stats_file = Path.home() / ".claude" / "stats-cache.json"

    if not stats_file.exists():
        return UsageAnalytics(
            total_sessions=0,
            total_messages=0,
            models=[],
            daily_activity=[],
            total_estimated_cost_usd=0.0,
            period_days=days
        )

    try:
        stats = json.loads(stats_file.read_text())
    except Exception:
        return UsageAnalytics(
            total_sessions=0,
            total_messages=0,
            models=[],
            daily_activity=[],
            total_estimated_cost_usd=0.0,
            period_days=days
        )

    models = []
    total_cost = 0.0
    model_usage = stats.get("modelUsage", {})

    for model_id, usage in model_usage.items():
        cost = calculate_model_cost(model_id, usage)
        total_cost += cost

        models.append(ModelUsage(
            model_id=model_id,
            input_tokens=usage.get("inputTokens", 0),
            output_tokens=usage.get("outputTokens", 0),
            cache_read_tokens=usage.get("cacheReadInputTokens", 0),
            cache_creation_tokens=usage.get("cacheCreationInputTokens", 0),
            estimated_cost_usd=round(cost, 2)
        ))

    daily_activity = []
    cutoff_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    token_by_date = {}
    for entry in stats.get("dailyModelTokens", []):
        token_by_date[entry["date"]] = entry.get("tokensByModel", {})

    for entry in stats.get("dailyActivity", []):
        if entry["date"] >= cutoff_date:
            daily_activity.append(DailyActivity(
                date=entry["date"],
                message_count=entry.get("messageCount", 0),
                session_count=entry.get("sessionCount", 0),
                tool_call_count=entry.get("toolCallCount", 0),
                tokens_by_model=token_by_date.get(entry["date"], {})
            ))

    daily_activity.sort(key=lambda x: x.date, reverse=True)

    return UsageAnalytics(
        total_sessions=stats.get("totalSessions", 0),
        total_messages=stats.get("totalMessages", 0),
        first_session_date=stats.get("firstSessionDate"),
        models=models,
        daily_activity=daily_activity,
        total_estimated_cost_usd=round(total_cost, 2),
        period_days=days
    )


@router.get("/api/projects/{project_id}/performance", response_model=list[AgentPerformance])
async def get_agent_performance(project_id: str):
    """Get performance metrics for all agents in a project."""
    project = db.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return db.get_agent_performance(project_id)


@router.get("/api/projects/{project_id}/agents/{agent_id}/history", response_model=list[TaskHistoryItem])
async def get_agent_task_history(project_id: str, agent_id: str, limit: int = 20):
    """Get recent task history for an agent."""
    agent = db.get_agent(agent_id)
    if not agent or agent["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="Agent not found")

    return db.get_agent_task_history(agent_id, limit)
