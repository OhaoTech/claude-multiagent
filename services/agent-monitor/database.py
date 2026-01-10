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

        # Initialize default global settings if not exist
        default_settings = {
            "theme": "dark",
            "default_mode": "normal",
            "editor_font_size": "14",
            "editor_tab_size": "2",
            "auto_save": "true",
            "sidebar_width": "220",
            "chat_panel_width": "300",
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
    worktree_path: Optional[str] = None
) -> dict:
    """Create a new agent for a project."""
    agent_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO agents (id, project_id, name, domain, worktree_path, status, is_leader, created_at)
            VALUES (?, ?, ?, ?, ?, 'active', 0, ?)
        """, (agent_id, project_id, name, domain, worktree_path, now))

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


def delete_agent(agent_id: str) -> bool:
    """Delete an agent (cannot delete leader)."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM agents WHERE id = ? AND is_leader = 0",
            (agent_id,)
        )
        return cursor.rowcount > 0


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


# Initialize database on import
init_db()
