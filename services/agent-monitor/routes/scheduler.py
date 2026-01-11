"""Scheduler control endpoints."""

from pathlib import Path

from fastapi import APIRouter, HTTPException

from models import SchedulerStatus
from services.websocket import manager
from scheduler import TaskScheduler, get_scheduler, set_scheduler
import database as db

router = APIRouter(prefix="/api/scheduler", tags=["scheduler"])


@router.get("/status", response_model=SchedulerStatus)
async def get_scheduler_status():
    """Get scheduler status."""
    scheduler = get_scheduler()
    if not scheduler:
        return SchedulerStatus(
            running=False,
            project_id=None,
            interval=5.0
        )

    return SchedulerStatus(
        running=scheduler.is_running,
        project_id=scheduler.project_id,
        interval=scheduler.interval,
        last_run=scheduler.last_run,
        paused_for_rate_limit=scheduler.is_paused_for_rate_limit,
        rate_limit_reason=scheduler.rate_limit_reason
    )


@router.get("/rate-limit")
async def get_rate_limit_status():
    """Get detailed rate limit status."""
    scheduler = get_scheduler()
    if not scheduler:
        from services.rate_limiter import RateLimitMonitor
        monitor = RateLimitMonitor()
        return {
            "scheduler_running": False,
            "usage": monitor.get_usage_percentage(),
            "should_pause": monitor.should_pause()[0],
            "should_throttle": monitor.should_throttle()[0],
        }

    return {
        "scheduler_running": scheduler.is_running,
        **scheduler.get_rate_limit_status()
    }


@router.post("/start", response_model=SchedulerStatus)
async def start_scheduler():
    """Start the task scheduler."""
    scheduler = get_scheduler()
    if not scheduler:
        active_project = db.get_active_project()
        if not active_project:
            raise HTTPException(status_code=400, detail="No active project")

        scheduler = TaskScheduler(
            project_id=active_project["id"],
            project_root=Path(active_project["root_path"]),
            broadcast_callback=manager.broadcast,
            interval=5.0
        )
        set_scheduler(scheduler)

    await scheduler.start()

    return SchedulerStatus(
        running=scheduler.is_running,
        project_id=scheduler.project_id,
        interval=scheduler.interval,
        last_run=scheduler.last_run
    )


@router.post("/stop", response_model=SchedulerStatus)
async def stop_scheduler():
    """Stop the task scheduler."""
    scheduler = get_scheduler()
    if scheduler:
        await scheduler.stop()

    return SchedulerStatus(
        running=False,
        project_id=scheduler.project_id if scheduler else None,
        interval=scheduler.interval if scheduler else 5.0,
        last_run=scheduler.last_run if scheduler else None
    )
