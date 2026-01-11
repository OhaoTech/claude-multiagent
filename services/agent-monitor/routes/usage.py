"""Usage analytics and performance endpoints."""

import json
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict

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


@router.get("/api/usage/realtime")
async def get_realtime_usage():
    """Get real-time usage by reading session files directly."""
    claude_dir = Path.home() / ".claude" / "projects"

    if not claude_dir.exists():
        return {
            "today": {"messages": 0, "tool_calls": 0, "tokens": 0, "sessions": 0},
            "sessions": []
        }

    today = datetime.now().strftime("%Y-%m-%d")
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    today_stats = {
        "messages": 0,
        "tool_calls": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_creation_tokens": 0,
        "sessions": set(),
        "models": defaultdict(lambda: {"input": 0, "output": 0})
    }

    recent_sessions = []

    # Find all jsonl files modified today
    try:
        for project_dir in claude_dir.iterdir():
            if not project_dir.is_dir():
                continue

            for jsonl_file in project_dir.glob("*.jsonl"):
                try:
                    # Check if modified today
                    mtime = datetime.fromtimestamp(jsonl_file.stat().st_mtime)
                    if mtime < today_start:
                        continue

                    session_stats = {
                        "session_id": jsonl_file.stem,
                        "project": project_dir.name,
                        "messages": 0,
                        "tool_calls": 0,
                        "tokens": 0,
                        "last_activity": None
                    }

                    with open(jsonl_file, 'r') as f:
                        for line in f:
                            if not line.strip():
                                continue
                            try:
                                entry = json.loads(line)
                                entry_type = entry.get("type")
                                timestamp_str = entry.get("timestamp", "")

                                # Parse timestamp
                                if timestamp_str:
                                    try:
                                        ts = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
                                        if ts.date().isoformat() != today:
                                            continue
                                        session_stats["last_activity"] = timestamp_str
                                    except:
                                        pass

                                if entry_type == "user":
                                    today_stats["messages"] += 1
                                    session_stats["messages"] += 1
                                    today_stats["sessions"].add(jsonl_file.stem)

                                elif entry_type == "assistant":
                                    today_stats["messages"] += 1
                                    session_stats["messages"] += 1

                                    msg = entry.get("message", {})
                                    usage = msg.get("usage", {})
                                    model = msg.get("model", "unknown")

                                    # Count tokens
                                    input_tokens = usage.get("input_tokens", 0)
                                    output_tokens = usage.get("output_tokens", 0)
                                    cache_read = usage.get("cache_read_input_tokens", 0) or usage.get("cacheReadInputTokens", 0)
                                    cache_creation = usage.get("cache_creation_input_tokens", 0) or usage.get("cacheCreationInputTokens", 0)

                                    today_stats["input_tokens"] += input_tokens
                                    today_stats["output_tokens"] += output_tokens
                                    today_stats["cache_read_tokens"] += cache_read
                                    today_stats["cache_creation_tokens"] += cache_creation
                                    today_stats["models"][model]["input"] += input_tokens + cache_read + cache_creation
                                    today_stats["models"][model]["output"] += output_tokens

                                    session_stats["tokens"] += input_tokens + output_tokens

                                    # Count tool calls
                                    content = msg.get("content", [])
                                    if isinstance(content, list):
                                        for block in content:
                                            if isinstance(block, dict) and block.get("type") == "tool_use":
                                                today_stats["tool_calls"] += 1
                                                session_stats["tool_calls"] += 1

                            except json.JSONDecodeError:
                                continue

                    if session_stats["messages"] > 0:
                        recent_sessions.append(session_stats)

                except Exception as e:
                    continue

    except Exception as e:
        print(f"Error reading session files: {e}")

    # Sort sessions by last activity
    recent_sessions.sort(key=lambda x: x.get("last_activity") or "", reverse=True)

    # Calculate estimated cost
    total_cost = 0.0
    for model_id, tokens in today_stats["models"].items():
        pricing = MODEL_PRICING.get(model_id, MODEL_PRICING["claude-opus-4-5-20251101"])
        input_cost = (tokens["input"] / 1_000_000) * pricing["input"]
        output_cost = (tokens["output"] / 1_000_000) * pricing["output"]
        total_cost += input_cost + output_cost

    return {
        "date": today,
        "today": {
            "messages": today_stats["messages"],
            "tool_calls": today_stats["tool_calls"],
            "input_tokens": today_stats["input_tokens"],
            "output_tokens": today_stats["output_tokens"],
            "cache_read_tokens": today_stats["cache_read_tokens"],
            "cache_creation_tokens": today_stats["cache_creation_tokens"],
            "total_tokens": today_stats["input_tokens"] + today_stats["output_tokens"] + today_stats["cache_read_tokens"],
            "sessions": len(today_stats["sessions"]),
            "estimated_cost_usd": round(total_cost, 4)
        },
        "models": dict(today_stats["models"]),
        "recent_sessions": recent_sessions[:10]
    }


@router.get("/api/usage/accurate")
async def get_accurate_usage(days: int = 30):
    """Get 100% accurate usage by scanning ALL session files.

    This is slower than the cached endpoint but provides real data.
    """
    claude_dir = Path.home() / ".claude" / "projects"

    if not claude_dir.exists():
        return {
            "total_sessions": 0,
            "total_messages": 0,
            "first_session_date": None,
            "models": [],
            "daily_activity": [],
            "total_estimated_cost_usd": 0.0,
            "period_days": days
        }

    # Use date string comparison to avoid timezone issues
    cutoff_date_str = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    # Track stats by date
    daily_stats = defaultdict(lambda: {
        "messages": 0,
        "tool_calls": 0,
        "sessions": set(),
    })

    # Track model usage totals
    model_stats = defaultdict(lambda: {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_creation_tokens": 0,
    })

    total_messages = 0
    all_sessions = set()
    first_session_date = None

    try:
        for project_dir in claude_dir.iterdir():
            if not project_dir.is_dir():
                continue

            for jsonl_file in project_dir.glob("*.jsonl"):
                try:
                    session_id = jsonl_file.stem
                    session_dates = set()

                    with open(jsonl_file, 'r') as f:
                        for line in f:
                            if not line.strip():
                                continue
                            try:
                                entry = json.loads(line)
                                entry_type = entry.get("type")
                                timestamp_str = entry.get("timestamp", "")

                                # Parse timestamp - extract date string directly
                                entry_date = None
                                if timestamp_str:
                                    try:
                                        # Extract date from ISO timestamp (first 10 chars: YYYY-MM-DD)
                                        entry_date = timestamp_str[:10]

                                        # Track first session date
                                        if first_session_date is None or entry_date < first_session_date:
                                            first_session_date = entry_date

                                        # Skip if before cutoff (string comparison works for ISO dates)
                                        if entry_date < cutoff_date_str:
                                            continue
                                    except:
                                        continue
                                else:
                                    continue

                                if entry_type == "user":
                                    daily_stats[entry_date]["messages"] += 1
                                    daily_stats[entry_date]["sessions"].add(session_id)
                                    session_dates.add(entry_date)
                                    total_messages += 1
                                    all_sessions.add(session_id)

                                elif entry_type == "assistant":
                                    daily_stats[entry_date]["messages"] += 1
                                    total_messages += 1

                                    msg = entry.get("message", {})
                                    usage = msg.get("usage", {})
                                    model = msg.get("model", "unknown")

                                    # Count tokens
                                    input_tokens = usage.get("input_tokens", 0)
                                    output_tokens = usage.get("output_tokens", 0)
                                    cache_read = usage.get("cache_read_input_tokens", 0) or usage.get("cacheReadInputTokens", 0)
                                    cache_creation = usage.get("cache_creation_input_tokens", 0) or usage.get("cacheCreationInputTokens", 0)

                                    model_stats[model]["input_tokens"] += input_tokens
                                    model_stats[model]["output_tokens"] += output_tokens
                                    model_stats[model]["cache_read_tokens"] += cache_read
                                    model_stats[model]["cache_creation_tokens"] += cache_creation

                                    # Count tool calls
                                    content = msg.get("content", [])
                                    if isinstance(content, list):
                                        for block in content:
                                            if isinstance(block, dict) and block.get("type") == "tool_use":
                                                daily_stats[entry_date]["tool_calls"] += 1

                            except json.JSONDecodeError:
                                continue

                except Exception as e:
                    print(f"Error reading {jsonl_file}: {e}")
                    continue

    except Exception as e:
        print(f"Error scanning session files: {e}")

    # Build model usage list with costs
    models = []
    total_cost = 0.0
    for model_id, stats in model_stats.items():
        pricing = MODEL_PRICING.get(model_id, MODEL_PRICING["claude-opus-4-5-20251101"])
        cost = (
            (stats["input_tokens"] / 1_000_000) * pricing["input"] +
            (stats["output_tokens"] / 1_000_000) * pricing["output"] +
            (stats["cache_read_tokens"] / 1_000_000) * pricing["cache_read"] +
            (stats["cache_creation_tokens"] / 1_000_000) * pricing["cache_creation"]
        )
        total_cost += cost

        models.append({
            "model_id": model_id,
            "input_tokens": stats["input_tokens"],
            "output_tokens": stats["output_tokens"],
            "cache_read_tokens": stats["cache_read_tokens"],
            "cache_creation_tokens": stats["cache_creation_tokens"],
            "estimated_cost_usd": round(cost, 2)
        })

    # Build daily activity list
    daily_activity = []
    for date, stats in sorted(daily_stats.items(), reverse=True):
        daily_activity.append({
            "date": date,
            "message_count": stats["messages"],
            "session_count": len(stats["sessions"]),
            "tool_call_count": stats["tool_calls"],
            "tokens_by_model": {}
        })

    return {
        "total_sessions": len(all_sessions),
        "total_messages": total_messages,
        "first_session_date": first_session_date,
        "models": sorted(models, key=lambda x: x["estimated_cost_usd"], reverse=True),
        "daily_activity": daily_activity,
        "total_estimated_cost_usd": round(total_cost, 2),
        "period_days": days
    }


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
