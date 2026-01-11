"""SQLite database operations for Claude Code Web IDE."""

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

# Database location
DB_DIR = Path.home() / ".claude-web"
DB_PATH = DB_DIR / "projects.db"


def get_db_path() -> Path:
    """Get database path, creating directory if needed."""
    DB_DIR.mkdir(parents=True, exist_ok=True)
    return DB_PATH


@contextmanager
def get_connection():
    """Get a database connection with row factory."""
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    """Initialize database tables."""
    with get_connection() as conn:
        cursor = conn.cursor()

        # Projects table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                root_path TEXT NOT NULL UNIQUE,
                description TEXT DEFAULT '',
                is_active INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)

        # Agents table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                domain TEXT NOT NULL,
                worktree_path TEXT,
                status TEXT DEFAULT 'active',
                is_leader INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                UNIQUE(project_id, name)
            )
        """)

        # Global settings table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)

        # Project settings table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS project_settings (
                project_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (project_id, key),
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        """)

        # Sprints table for sprint planning
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sprints (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                goal TEXT,
                status TEXT DEFAULT 'planning',
                start_date TEXT,
                end_date TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        """)

        # Tasks table for task queue
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                agent_id TEXT,
                sprint_id TEXT,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT DEFAULT 'pending',
                priority INTEGER DEFAULT 1,
                retry_count INTEGER DEFAULT 0,
                max_retries INTEGER DEFAULT 2,
                depends_on TEXT DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT,
                result TEXT,
                error TEXT,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
                FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE SET NULL
            )
        """)

        # Task templates table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS task_templates (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                priority INTEGER DEFAULT 1,
                agent_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
            )
        """)

        # Company plans table for Phase 5 brainstorm
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS company_plans (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                description TEXT NOT NULL,
                agents TEXT NOT NULL,
                first_sprint TEXT NOT NULL,
                architecture_notes TEXT,
                status TEXT DEFAULT 'pending',
                created_at TEXT NOT NULL,
                approved_at TEXT,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        """)

        # Initialize default global settings if not exist
        default_settings = {
            "theme": "dark",
            "default_mode": "normal",
            "editor_font_size": "14",
            "editor_tab_size": "2",
            "auto_save": "true",
            "sidebar_width": "220",
            "chat_panel_width": "300",
            "model": "sonnet",  # haiku, sonnet, opus
        }

        for key, value in default_settings.items():
            cursor.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, value)
            )


# =============================================================================
# Project Operations
# =============================================================================

def create_project(name: str, root_path: str, description: str = "") -> dict:
    """Create a new project."""
    project_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    with get_connection() as conn:
        cursor = conn.cursor()

        # Deactivate all other projects
        cursor.execute("UPDATE projects SET is_active = 0")

        # Create new project as active
        cursor.execute("""
            INSERT INTO projects (id, name, root_path, description, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
        """, (project_id, name, root_path, description, now, now))

        # Create default "leader" agent
        agent_id = str(uuid.uuid4())
        cursor.execute("""
            INSERT INTO agents (id, project_id, name, domain, worktree_path, status, is_leader, created_at)
            VALUES (?, ?, 'leader', '.', ?, 'active', 1, ?)
        """, (agent_id, project_id, root_path, now))

    return get_project(project_id)


def get_project(project_id: str) -> Optional[dict]:
    """Get a project by ID."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def get_project_by_path(root_path: str) -> Optional[dict]:
    """Get a project by root path."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM projects WHERE root_path = ?", (root_path,))
        row = cursor.fetchone()
        return dict(row) if row else None


def list_projects() -> list[dict]:
    """List all projects, active first."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM projects
            ORDER BY is_active DESC, updated_at DESC
        """)
        return [dict(row) for row in cursor.fetchall()]


def update_project(project_id: str, **kwargs) -> Optional[dict]:
    """Update a project."""
    allowed_fields = {"name", "description", "root_path"}
    updates = {k: v for k, v in kwargs.items() if k in allowed_fields}

    if not updates:
        return get_project(project_id)

    updates["updated_at"] = datetime.utcnow().isoformat()

    set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
    values = list(updates.values()) + [project_id]

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"UPDATE projects SET {set_clause} WHERE id = ?", values)

    return get_project(project_id)


def delete_project(project_id: str) -> bool:
    """Delete a project and its agents."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        return cursor.rowcount > 0


def set_active_project(project_id: str) -> Optional[dict]:
    """Set a project as active."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE projects SET is_active = 0")
        cursor.execute(
            "UPDATE projects SET is_active = 1, updated_at = ? WHERE id = ?",
            (datetime.utcnow().isoformat(), project_id)
        )
    return get_project(project_id)


def get_active_project() -> Optional[dict]:
    """Get the currently active project."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM projects WHERE is_active = 1 LIMIT 1")
        row = cursor.fetchone()
        return dict(row) if row else None


# =============================================================================
# Agent Operations
# =============================================================================

def create_agent(
    project_id: str,
    name: str,
    domain: str,
    worktree_path: Optional[str] = None,
    is_leader: bool = False
) -> dict:
    """Create a new agent for a project."""
    agent_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO agents (id, project_id, name, domain, worktree_path, status, is_leader, created_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
        """, (agent_id, project_id, name, domain, worktree_path, 1 if is_leader else 0, now))

    return get_agent(agent_id)


def get_agent(agent_id: str) -> Optional[dict]:
    """Get an agent by ID."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM agents WHERE id = ?", (agent_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def get_agent_by_name(project_id: str, name: str) -> Optional[dict]:
    """Get an agent by project and name."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM agents WHERE project_id = ? AND name = ?",
            (project_id, name)
        )
        row = cursor.fetchone()
        return dict(row) if row else None


def list_agents(project_id: str) -> list[dict]:
    """List all agents for a project."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM agents
            WHERE project_id = ?
            ORDER BY is_leader DESC, name ASC
        """, (project_id,))
        return [dict(row) for row in cursor.fetchall()]


def update_agent(agent_id: str, **kwargs) -> Optional[dict]:
    """Update an agent."""
    allowed_fields = {"name", "domain", "worktree_path", "status"}
    updates = {k: v for k, v in kwargs.items() if k in allowed_fields}

    if not updates:
        return get_agent(agent_id)

    set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
    values = list(updates.values()) + [agent_id]

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"UPDATE agents SET {set_clause} WHERE id = ?", values)

    return get_agent(agent_id)


def delete_agent(agent_id: str, force: bool = False) -> bool:
    """Delete an agent. If force=True, can delete even leader."""
    with get_connection() as conn:
        cursor = conn.cursor()
        if force:
            cursor.execute("DELETE FROM agents WHERE id = ?", (agent_id,))
        else:
            cursor.execute(
                "DELETE FROM agents WHERE id = ? AND is_leader = 0",
                (agent_id,)
            )
        return cursor.rowcount > 0


def set_leader(project_id: str, agent_id: str) -> Optional[dict]:
    """Set an agent as the leader (removes leader status from others)."""
    with get_connection() as conn:
        cursor = conn.cursor()
        # First, verify the agent exists and belongs to the project
        cursor.execute(
            "SELECT id FROM agents WHERE id = ? AND project_id = ?",
            (agent_id, project_id)
        )
        if not cursor.fetchone():
            return None

        # Remove leader status from all agents in the project
        cursor.execute(
            "UPDATE agents SET is_leader = 0 WHERE project_id = ?",
            (project_id,)
        )
        # Set the new leader
        cursor.execute(
            "UPDATE agents SET is_leader = 1 WHERE id = ?",
            (agent_id,)
        )

    return get_agent(agent_id)


# =============================================================================
# Settings Operations
# =============================================================================

def get_settings() -> dict:
    """Get all global settings."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM settings")
        settings = {}
        for row in cursor.fetchall():
            value = row["value"]
            # Try to parse JSON values
            try:
                value = json.loads(value)
            except (json.JSONDecodeError, TypeError):
                # Keep as string if not JSON
                if value == "true":
                    value = True
                elif value == "false":
                    value = False
                elif value.isdigit():
                    value = int(value)
            settings[row["key"]] = value
        return settings


def update_settings(**kwargs) -> dict:
    """Update global settings."""
    with get_connection() as conn:
        cursor = conn.cursor()
        for key, value in kwargs.items():
            # Convert to string for storage
            if isinstance(value, bool):
                value = "true" if value else "false"
            elif isinstance(value, (dict, list)):
                value = json.dumps(value)
            else:
                value = str(value)

            cursor.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                (key, value)
            )
    return get_settings()


def get_project_settings(project_id: str) -> dict:
    """Get settings for a specific project."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT key, value FROM project_settings WHERE project_id = ?",
            (project_id,)
        )
        settings = {}
        for row in cursor.fetchall():
            value = row["value"]
            try:
                value = json.loads(value)
            except (json.JSONDecodeError, TypeError):
                if value == "true":
                    value = True
                elif value == "false":
                    value = False
                elif value.isdigit():
                    value = int(value)
            settings[row["key"]] = value
        return settings


def update_project_settings(project_id: str, **kwargs) -> dict:
    """Update settings for a specific project."""
    with get_connection() as conn:
        cursor = conn.cursor()
        for key, value in kwargs.items():
            if isinstance(value, bool):
                value = "true" if value else "false"
            elif isinstance(value, (dict, list)):
                value = json.dumps(value)
            else:
                value = str(value)

            cursor.execute(
                "INSERT OR REPLACE INTO project_settings (project_id, key, value) VALUES (?, ?, ?)",
                (project_id, key, value)
            )
    return get_project_settings(project_id)


# =============================================================================
# Task Operations
# =============================================================================

def create_task(
    project_id: str,
    title: str,
    description: Optional[str] = None,
    agent_id: Optional[str] = None,
    sprint_id: Optional[str] = None,
    priority: int = 1,
    depends_on: Optional[list[str]] = None
) -> dict:
    """Create a new task in the queue."""
    task_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    depends_on_json = json.dumps(depends_on or [])

    # If task has dependencies, start as blocked
    status = "blocked" if depends_on else "pending"

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO tasks (
                id, project_id, agent_id, sprint_id, title, description, status,
                priority, depends_on, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            task_id, project_id, agent_id, sprint_id, title, description,
            status, priority, depends_on_json, now, now
        ))

    return get_task(task_id)


def get_task(task_id: str) -> Optional[dict]:
    """Get a task by ID."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
        row = cursor.fetchone()
        if row:
            task = dict(row)
            # Parse JSON fields
            task["depends_on"] = json.loads(task.get("depends_on", "[]"))
            if task.get("result"):
                try:
                    task["result"] = json.loads(task["result"])
                except json.JSONDecodeError:
                    pass
            return task
        return None


def list_tasks(
    project_id: str,
    status: Optional[str] = None,
    agent_id: Optional[str] = None,
    sprint_id: Optional[str] = None,
    order_by: str = "priority DESC, created_at ASC"
) -> list[dict]:
    """List tasks for a project with optional filters."""
    with get_connection() as conn:
        cursor = conn.cursor()

        query = "SELECT * FROM tasks WHERE project_id = ?"
        params = [project_id]

        if status:
            query += " AND status = ?"
            params.append(status)

        if agent_id:
            query += " AND agent_id = ?"
            params.append(agent_id)

        if sprint_id is not None:
            if sprint_id == "":
                query += " AND sprint_id IS NULL"
            else:
                query += " AND sprint_id = ?"
                params.append(sprint_id)

        query += f" ORDER BY {order_by}"

        cursor.execute(query, params)
        tasks = []
        for row in cursor.fetchall():
            task = dict(row)
            task["depends_on"] = json.loads(task.get("depends_on", "[]"))
            if task.get("result"):
                try:
                    task["result"] = json.loads(task["result"])
                except json.JSONDecodeError:
                    pass
            tasks.append(task)
        return tasks


def update_task(task_id: str, **kwargs) -> Optional[dict]:
    """Update a task."""
    allowed_fields = {
        "title", "description", "status", "agent_id", "sprint_id", "priority",
        "retry_count", "max_retries", "depends_on", "started_at",
        "completed_at", "result", "error"
    }
    updates = {k: v for k, v in kwargs.items() if k in allowed_fields}

    if not updates:
        return get_task(task_id)

    updates["updated_at"] = datetime.utcnow().isoformat()

    # Serialize JSON fields
    if "depends_on" in updates:
        updates["depends_on"] = json.dumps(updates["depends_on"])
    if "result" in updates and isinstance(updates["result"], (dict, list)):
        updates["result"] = json.dumps(updates["result"])

    set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
    values = list(updates.values()) + [task_id]

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"UPDATE tasks SET {set_clause} WHERE id = ?", values)

    return get_task(task_id)


def delete_task(task_id: str) -> bool:
    """Delete a task."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        return cursor.rowcount > 0


def get_queue_stats(project_id: str) -> dict:
    """Get task queue statistics for a project."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT status, COUNT(*) as count
            FROM tasks
            WHERE project_id = ?
            GROUP BY status
        """, (project_id,))

        stats = {
            "pending": 0,
            "blocked": 0,
            "assigned": 0,
            "running": 0,
            "completed": 0,
            "failed": 0,
            "total": 0
        }

        for row in cursor.fetchall():
            stats[row["status"]] = row["count"]
            stats["total"] += row["count"]

        return stats


def get_blocked_tasks(project_id: str) -> list[dict]:
    """Get all blocked tasks for dependency checking."""
    return list_tasks(project_id, status="blocked")


def get_pending_tasks_for_agent(project_id: str, agent_id: str) -> list[dict]:
    """Get pending tasks that can be assigned to a specific agent."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM tasks
            WHERE project_id = ?
            AND status = 'pending'
            AND (agent_id IS NULL OR agent_id = ?)
            ORDER BY
                CASE WHEN agent_id = ? THEN 0 ELSE 1 END,
                priority DESC,
                created_at ASC
        """, (project_id, agent_id, agent_id))

        tasks = []
        for row in cursor.fetchall():
            task = dict(row)
            task["depends_on"] = json.loads(task.get("depends_on", "[]"))
            tasks.append(task)
        return tasks


# =============================================================================
# Sprint Operations
# =============================================================================

def create_sprint(
    project_id: str,
    name: str,
    goal: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
) -> dict:
    """Create a new sprint."""
    sprint_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO sprints (
                id, project_id, name, goal, status, start_date, end_date,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, 'planning', ?, ?, ?, ?)
        """, (sprint_id, project_id, name, goal, start_date, end_date, now, now))

    return get_sprint(sprint_id)


def get_sprint(sprint_id: str) -> Optional[dict]:
    """Get a sprint by ID."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM sprints WHERE id = ?", (sprint_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def list_sprints(project_id: str, status: Optional[str] = None) -> list[dict]:
    """List all sprints for a project."""
    with get_connection() as conn:
        cursor = conn.cursor()

        query = "SELECT * FROM sprints WHERE project_id = ?"
        params = [project_id]

        if status:
            query += " AND status = ?"
            params.append(status)

        query += " ORDER BY created_at DESC"

        cursor.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]


def update_sprint(sprint_id: str, **kwargs) -> Optional[dict]:
    """Update a sprint."""
    allowed_fields = {"name", "goal", "status", "start_date", "end_date"}
    updates = {k: v for k, v in kwargs.items() if k in allowed_fields}

    if not updates:
        return get_sprint(sprint_id)

    updates["updated_at"] = datetime.utcnow().isoformat()

    set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
    values = list(updates.values()) + [sprint_id]

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"UPDATE sprints SET {set_clause} WHERE id = ?", values)

    return get_sprint(sprint_id)


def delete_sprint(sprint_id: str) -> bool:
    """Delete a sprint (tasks remain but lose sprint_id)."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sprints WHERE id = ?", (sprint_id,))
        return cursor.rowcount > 0


def get_sprint_stats(sprint_id: str) -> dict:
    """Get task statistics for a sprint."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT status, COUNT(*) as count
            FROM tasks
            WHERE sprint_id = ?
            GROUP BY status
        """, (sprint_id,))

        stats = {
            "pending": 0,
            "blocked": 0,
            "running": 0,
            "completed": 0,
            "failed": 0,
            "total": 0
        }

        for row in cursor.fetchall():
            stats[row["status"]] = row["count"]
            stats["total"] += row["count"]

        return stats


def get_sprint_burndown(sprint_id: str) -> list[dict]:
    """Get burndown data for a sprint.

    Returns day-by-day remaining task count from sprint start to end/today.
    """
    sprint = get_sprint(sprint_id)
    if not sprint:
        return []

    with get_connection() as conn:
        cursor = conn.cursor()

        # Get all tasks in this sprint with their completion dates
        cursor.execute("""
            SELECT id, status, created_at, completed_at
            FROM tasks
            WHERE sprint_id = ?
        """, (sprint_id,))

        tasks = [dict(row) for row in cursor.fetchall()]

    if not tasks:
        return []

    # Determine date range
    start_date = sprint.get("start_date")
    end_date = sprint.get("end_date")

    if not start_date:
        # Use earliest task creation date
        start_date = min(t["created_at"][:10] for t in tasks)
    else:
        start_date = start_date[:10]

    if not end_date or sprint["status"] == "active":
        # Use today for active sprints
        end_date = datetime.utcnow().strftime("%Y-%m-%d")
    else:
        end_date = end_date[:10]

    # Calculate remaining tasks for each day
    from datetime import timedelta
    burndown = []
    total_tasks = len(tasks)

    current = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")

    # Calculate ideal burndown (linear from total to 0)
    total_days = (end - current).days + 1

    day_index = 0
    while current <= end:
        current_date = current.strftime("%Y-%m-%d")

        # Count completed tasks up to this date
        completed_count = sum(
            1 for t in tasks
            if t["completed_at"] and t["completed_at"][:10] <= current_date
        )

        remaining = total_tasks - completed_count
        ideal = max(0, total_tasks - (total_tasks * day_index / max(1, total_days - 1))) if total_days > 1 else 0

        burndown.append({
            "date": current_date,
            "remaining": remaining,
            "ideal": round(ideal, 1),
            "completed": completed_count
        })

        current += timedelta(days=1)
        day_index += 1

    return burndown


def get_velocity_data(project_id: str, limit: int = 10) -> list[dict]:
    """Get velocity data for completed sprints.

    Returns completed task count per sprint, ordered by completion date.
    """
    with get_connection() as conn:
        cursor = conn.cursor()

        # Get completed sprints with their task counts
        cursor.execute("""
            SELECT
                s.id,
                s.name,
                s.status,
                s.start_date,
                s.end_date,
                COUNT(t.id) as total_tasks,
                SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks
            FROM sprints s
            LEFT JOIN tasks t ON t.sprint_id = s.id
            WHERE s.project_id = ?
            AND s.status IN ('completed', 'active')
            GROUP BY s.id
            ORDER BY COALESCE(s.end_date, s.updated_at) DESC
            LIMIT ?
        """, (project_id, limit))

        # Reverse to show oldest first
        rows = list(cursor.fetchall())
        rows.reverse()

        return [{
            "sprint_id": row["id"],
            "sprint_name": row["name"],
            "status": row["status"],
            "start_date": row["start_date"],
            "end_date": row["end_date"],
            "total_tasks": row["total_tasks"] or 0,
            "completed_tasks": row["completed_tasks"] or 0,
            "velocity": row["completed_tasks"] or 0
        } for row in rows]


# =============================================================================
# Task Template Operations
# =============================================================================

def create_task_template(
    project_id: str,
    name: str,
    title: str,
    description: Optional[str] = None,
    priority: int = 1,
    agent_id: Optional[str] = None
) -> dict:
    """Create a new task template."""
    template_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO task_templates (
                id, project_id, name, title, description, priority,
                agent_id, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (template_id, project_id, name, title, description, priority, agent_id, now, now))

    return get_task_template(template_id)


def get_task_template(template_id: str) -> Optional[dict]:
    """Get a task template by ID."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM task_templates WHERE id = ?", (template_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def list_task_templates(project_id: str) -> list[dict]:
    """List all task templates for a project."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM task_templates WHERE project_id = ? ORDER BY name ASC",
            (project_id,)
        )
        return [dict(row) for row in cursor.fetchall()]


def update_task_template(template_id: str, **kwargs) -> Optional[dict]:
    """Update a task template."""
    allowed_fields = {"name", "title", "description", "priority", "agent_id"}
    updates = {k: v for k, v in kwargs.items() if k in allowed_fields}

    if not updates:
        return get_task_template(template_id)

    updates["updated_at"] = datetime.utcnow().isoformat()

    set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
    values = list(updates.values()) + [template_id]

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"UPDATE task_templates SET {set_clause} WHERE id = ?", values)

    return get_task_template(template_id)


def delete_task_template(template_id: str) -> bool:
    """Delete a task template."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM task_templates WHERE id = ?", (template_id,))
        return cursor.rowcount > 0


def create_task_from_template(
    template_id: str,
    sprint_id: Optional[str] = None
) -> Optional[dict]:
    """Create a new task from a template."""
    template = get_task_template(template_id)
    if not template:
        return None

    return create_task(
        project_id=template["project_id"],
        title=template["title"],
        description=template["description"],
        agent_id=template["agent_id"],
        sprint_id=sprint_id,
        priority=template["priority"]
    )


# =============================================================================
# Agent Performance Metrics
# =============================================================================

def get_agent_performance(project_id: str) -> list[dict]:
    """Get performance metrics for all agents in a project."""
    with get_connection() as conn:
        cursor = conn.cursor()

        # Get all agents for the project
        cursor.execute("""
            SELECT
                a.id,
                a.name,
                a.domain,
                a.status,
                COUNT(t.id) as total_tasks,
                SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
                SUM(CASE WHEN t.status = 'failed' THEN 1 ELSE 0 END) as failed_tasks,
                SUM(CASE WHEN t.status = 'running' THEN 1 ELSE 0 END) as running_tasks,
                AVG(
                    CASE WHEN t.completed_at IS NOT NULL AND t.started_at IS NOT NULL
                    THEN (julianday(t.completed_at) - julianday(t.started_at)) * 24 * 60
                    ELSE NULL END
                ) as avg_duration_minutes
            FROM agents a
            LEFT JOIN tasks t ON t.agent_id = a.id
            WHERE a.project_id = ?
            GROUP BY a.id
            ORDER BY completed_tasks DESC
        """, (project_id,))

        results = []
        for row in cursor.fetchall():
            total = row["total_tasks"] or 0
            completed = row["completed_tasks"] or 0
            failed = row["failed_tasks"] or 0
            running = row["running_tasks"] or 0

            success_rate = (completed / total * 100) if total > 0 else 0

            results.append({
                "agent_id": row["id"],
                "agent_name": row["name"],
                "domain": row["domain"],
                "status": row["status"],
                "total_tasks": total,
                "completed_tasks": completed,
                "failed_tasks": failed,
                "running_tasks": running,
                "success_rate": round(success_rate, 1),
                "avg_duration_minutes": round(row["avg_duration_minutes"] or 0, 1)
            })

        return results


def get_agent_task_history(agent_id: str, limit: int = 20) -> list[dict]:
    """Get recent task history for an agent."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, title, status, priority, started_at, completed_at
            FROM tasks
            WHERE agent_id = ?
            ORDER BY COALESCE(completed_at, updated_at) DESC
            LIMIT ?
        """, (agent_id, limit))

        return [dict(row) for row in cursor.fetchall()]


# =============================================================================
# Company Plans Operations (Phase 5 Brainstorm)
# =============================================================================

def create_company_plan(
    project_id: str,
    description: str,
    agents: list[dict],
    first_sprint: list[dict],
    architecture_notes: Optional[str] = None
) -> dict:
    """Create a new company plan from brainstorm."""
    plan_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO company_plans (
                id, project_id, description, agents, first_sprint,
                architecture_notes, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
        """, (
            plan_id, project_id, description,
            json.dumps(agents), json.dumps(first_sprint),
            architecture_notes, now
        ))

    return get_company_plan(plan_id)


def get_company_plan(plan_id: str) -> Optional[dict]:
    """Get a company plan by ID."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM company_plans WHERE id = ?", (plan_id,))
        row = cursor.fetchone()
        if row:
            data = dict(row)
            data["agents"] = json.loads(data["agents"])
            data["first_sprint"] = json.loads(data["first_sprint"])
            return data
    return None


def list_company_plans(project_id: str, status: Optional[str] = None) -> list[dict]:
    """List company plans for a project."""
    with get_connection() as conn:
        cursor = conn.cursor()
        if status:
            cursor.execute(
                "SELECT * FROM company_plans WHERE project_id = ? AND status = ? ORDER BY created_at DESC",
                (project_id, status)
            )
        else:
            cursor.execute(
                "SELECT * FROM company_plans WHERE project_id = ? ORDER BY created_at DESC",
                (project_id,)
            )

        results = []
        for row in cursor.fetchall():
            data = dict(row)
            data["agents"] = json.loads(data["agents"])
            data["first_sprint"] = json.loads(data["first_sprint"])
            results.append(data)
        return results


def update_company_plan(plan_id: str, **updates) -> Optional[dict]:
    """Update a company plan."""
    if not updates:
        return get_company_plan(plan_id)

    # Convert lists to JSON strings
    if "agents" in updates:
        updates["agents"] = json.dumps(updates["agents"])
    if "first_sprint" in updates:
        updates["first_sprint"] = json.dumps(updates["first_sprint"])

    set_clause = ", ".join(f"{k} = ?" for k in updates.keys())

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"UPDATE company_plans SET {set_clause} WHERE id = ?",
            (*updates.values(), plan_id)
        )

    return get_company_plan(plan_id)


def approve_company_plan(plan_id: str) -> Optional[dict]:
    """Approve a company plan."""
    now = datetime.utcnow().isoformat()
    return update_company_plan(plan_id, status="approved", approved_at=now)


def delete_company_plan(plan_id: str) -> bool:
    """Delete a company plan."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM company_plans WHERE id = ?", (plan_id,))
        return cursor.rowcount > 0


# Initialize database on import
init_db()
