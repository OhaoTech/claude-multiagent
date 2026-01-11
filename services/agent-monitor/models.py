"""Data models for Agent Monitor."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel


class AgentState(BaseModel):
    """Current state of the agent orchestration system."""
    current: Optional[str] = None
    last: Optional[str] = None
    status: Optional[Literal["running", "success", "failed"]] = None
    task: Optional[str] = None
    started: Optional[int] = None
    completed: Optional[int] = None
    exit_code: Optional[int] = None


class AgentResult(BaseModel):
    """Result from an agent execution."""
    agent: str
    status: Literal["success", "failed", "needs-help"]
    summary: str = ""
    files_changed: list[str] = []
    needs: list[str] = []
    timestamp: int
    cost_usd: Optional[float] = None
    duration_ms: Optional[int] = None


class AgentInfo(BaseModel):
    """Information about an agent."""
    name: str
    domain: str
    worktree: str
    last_result: Optional[AgentResult] = None
    result_count: int = 0


class Command(BaseModel):
    """Command to send to an agent."""
    agent: str
    content: str
    type: Literal["dispatch", "message"] = "message"


class CommandFile(BaseModel):
    """Command file written to inbox."""
    id: str
    agent: str
    content: str
    type: str
    timestamp: int
    status: Literal["pending", "processed"] = "pending"


class WSMessage(BaseModel):
    """WebSocket message format."""
    type: Literal["state", "result", "output", "command_ack", "connected", "chat_output", "chat_done"]
    data: dict
    timestamp: datetime = datetime.now()


class SessionInfo(BaseModel):
    """Summary info about a Claude Code session."""
    session_id: str
    agent_id: str
    agent: str  # leader, api, mobile, admin, pipeline, services
    message_count: int
    first_timestamp: Optional[float] = None
    last_timestamp: Optional[float] = None
    cost_usd: float = 0.0
    last_message_preview: str = ""
    cwd: str = ""


class SessionMessage(BaseModel):
    """A single message from a session."""
    type: Literal["user", "assistant", "system", "tool_result", "summary"]
    content: str
    timestamp: Optional[float] = None
    uuid: str = ""
    model: Optional[str] = None
    usage: Optional[dict] = None


class ChatRequest(BaseModel):
    """Request to send a chat message."""
    session_id: Optional[str] = None  # None = new session
    agent: str = "leader"
    message: str
    resume: bool = True  # Whether to resume existing session


# =============================================================================
# New Models for Multi-Project Support
# =============================================================================

class ProjectCreate(BaseModel):
    """Request to create a new project."""
    name: str
    root_path: str
    description: str = ""
    init_git: bool = False  # Initialize git repo if not already one


class ProjectUpdate(BaseModel):
    """Request to update a project."""
    name: Optional[str] = None
    description: Optional[str] = None


class ProjectResponse(BaseModel):
    """Project response model."""
    id: str
    name: str
    root_path: str
    description: str
    is_active: bool
    created_at: str
    updated_at: str


class AgentCreate(BaseModel):
    """Request to create a new agent."""
    name: str
    domain: str  # Relative path within project, e.g., "apps/api"


class AgentUpdate(BaseModel):
    """Request to update an agent."""
    name: Optional[str] = None
    domain: Optional[str] = None
    status: Optional[Literal["active", "inactive"]] = None
    nickname: Optional[str] = None


class AgentResponse(BaseModel):
    """Agent response model."""
    id: str
    project_id: str
    name: str
    domain: str
    worktree_path: Optional[str]
    status: str
    is_leader: bool
    nickname: Optional[str] = None
    created_at: str


class SettingsResponse(BaseModel):
    """Global settings response."""
    theme: str = "dark"
    default_mode: str = "normal"
    editor_font_size: int = 14
    editor_tab_size: int = 2
    auto_save: bool = True
    sidebar_width: int = 220
    chat_panel_width: int = 300
    last_project_id: Optional[str] = None
    model: str = "sonnet"  # haiku, sonnet, opus


class SettingsUpdate(BaseModel):
    """Request to update global settings."""
    theme: Optional[str] = None
    default_mode: Optional[str] = None
    editor_font_size: Optional[int] = None
    editor_tab_size: Optional[int] = None
    auto_save: Optional[bool] = None
    sidebar_width: Optional[int] = None
    chat_panel_width: Optional[int] = None
    model: Optional[str] = None  # haiku, sonnet, opus


class ProjectSettingsResponse(BaseModel):
    """Project-specific settings response."""
    default_agent: str = "leader"
    git_auto_commit: bool = False
    file_excludes: list[str] = [".git", "node_modules", "__pycache__", ".venv"]


class ProjectSettingsUpdate(BaseModel):
    """Request to update project settings."""
    default_agent: Optional[str] = None
    git_auto_commit: Optional[bool] = None
    file_excludes: Optional[list[str]] = None


class FileTreeNode(BaseModel):
    """File tree node for file explorer."""
    name: str
    path: str
    is_dir: bool
    children: Optional[list["FileTreeNode"]] = None
    size: Optional[int] = None
    modified: Optional[float] = None
    git_status: Optional[str] = None  # M, A, D, U, ?


class FileContent(BaseModel):
    """File content response."""
    path: str
    content: str
    encoding: str = "utf-8"
    size: int
    modified: float


class FileWriteRequest(BaseModel):
    """Request to write file content."""
    path: str
    content: str


class FileCreateRequest(BaseModel):
    """Request to create a file or folder."""
    path: str
    is_dir: bool = False
    content: str = ""


class FileRenameRequest(BaseModel):
    """Request to rename/move a file."""
    old_path: str
    new_path: str


# =============================================================================
# Task Queue Models
# =============================================================================

class TaskCreate(BaseModel):
    """Request to create a new task."""
    title: str
    description: Optional[str] = None
    agent_id: Optional[str] = None  # Pre-assign to agent
    sprint_id: Optional[str] = None  # Assign to sprint
    priority: int = 1  # 0=low, 1=normal, 2=high, 3=urgent
    depends_on: list[str] = []  # Task IDs this task depends on


class TaskUpdate(BaseModel):
    """Request to update a task."""
    title: Optional[str] = None
    description: Optional[str] = None
    agent_id: Optional[str] = None
    sprint_id: Optional[str] = None
    priority: Optional[int] = None
    status: Optional[Literal["pending", "blocked", "assigned", "running", "completed", "failed"]] = None
    depends_on: Optional[list[str]] = None


class TaskResponse(BaseModel):
    """Task response model."""
    id: str
    project_id: str
    agent_id: Optional[str]
    sprint_id: Optional[str] = None
    title: str
    description: Optional[str]
    status: str
    priority: int
    retry_count: int
    max_retries: int
    depends_on: list[str]
    created_at: str
    updated_at: str
    started_at: Optional[str]
    completed_at: Optional[str]
    result: Optional[dict] = None
    error: Optional[str] = None


class TaskAssign(BaseModel):
    """Request to assign a task to an agent."""
    agent_id: str


class QueueStats(BaseModel):
    """Task queue statistics."""
    pending: int
    blocked: int
    assigned: int
    running: int
    completed: int
    failed: int
    total: int


class SchedulerStatus(BaseModel):
    """Scheduler status response."""
    running: bool
    project_id: Optional[str]
    interval: float
    last_run: Optional[str] = None
    paused_for_rate_limit: bool = False
    rate_limit_reason: Optional[str] = None


# =============================================================================
# Task Template Models
# =============================================================================

class TaskTemplateCreate(BaseModel):
    """Request to create a task template."""
    name: str
    title: str
    description: Optional[str] = None
    priority: int = 1
    agent_id: Optional[str] = None


class TaskTemplateUpdate(BaseModel):
    """Request to update a task template."""
    name: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[int] = None
    agent_id: Optional[str] = None


class TaskTemplateResponse(BaseModel):
    """Task template response model."""
    id: str
    project_id: str
    name: str
    title: str
    description: Optional[str]
    priority: int
    agent_id: Optional[str]
    created_at: str
    updated_at: str


class CreateFromTemplateRequest(BaseModel):
    """Request to create a task from a template."""
    sprint_id: Optional[str] = None


# =============================================================================
# Sprint Planning Models
# =============================================================================

class SprintCreate(BaseModel):
    """Request to create a new sprint."""
    name: str
    goal: Optional[str] = None
    start_date: Optional[str] = None  # ISO date string
    end_date: Optional[str] = None


class SprintUpdate(BaseModel):
    """Request to update a sprint."""
    name: Optional[str] = None
    goal: Optional[str] = None
    status: Optional[Literal["planning", "active", "completed", "cancelled"]] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class SprintResponse(BaseModel):
    """Sprint response model."""
    id: str
    project_id: str
    name: str
    goal: Optional[str]
    status: str
    start_date: Optional[str]
    end_date: Optional[str]
    created_at: str
    updated_at: str


class SprintStats(BaseModel):
    """Sprint statistics."""
    pending: int
    blocked: int
    running: int
    completed: int
    failed: int
    total: int
    completion_percent: float = 0.0


class BurndownPoint(BaseModel):
    """A single point in the burndown chart."""
    date: str
    remaining: int
    ideal: float
    completed: int


class VelocityPoint(BaseModel):
    """Velocity data for a single sprint."""
    sprint_id: str
    sprint_name: str
    status: str
    start_date: Optional[str]
    end_date: Optional[str]
    total_tasks: int
    completed_tasks: int
    velocity: int


# =============================================================================
# Agent Performance Models
# =============================================================================

class AgentPerformance(BaseModel):
    """Performance metrics for a single agent."""
    agent_id: str
    agent_name: str
    domain: str
    status: str
    total_tasks: int
    completed_tasks: int
    failed_tasks: int
    running_tasks: int
    success_rate: float
    avg_duration_minutes: float


class TaskHistoryItem(BaseModel):
    """A single task in agent history."""
    id: str
    title: str
    status: str
    priority: int
    started_at: Optional[str]
    completed_at: Optional[str]


# =============================================================================
# Usage Analytics Models
# =============================================================================

class ModelUsage(BaseModel):
    """Usage stats for a specific model."""
    model_id: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_creation_tokens: int
    estimated_cost_usd: float


class DailyActivity(BaseModel):
    """Activity stats for a specific day."""
    date: str
    message_count: int
    session_count: int
    tool_call_count: int
    tokens_by_model: dict[str, int] = {}


class UsageAnalytics(BaseModel):
    """Complete usage analytics response."""
    total_sessions: int
    total_messages: int
    first_session_date: Optional[str] = None
    models: list[ModelUsage]
    daily_activity: list[DailyActivity]
    total_estimated_cost_usd: float
    period_days: int
