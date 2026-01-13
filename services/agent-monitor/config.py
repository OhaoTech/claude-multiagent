"""Configuration for Agent Monitor service."""

import os
from pathlib import Path

# Repository root
REPO_ROOT = Path(__file__).parent.parent.parent

# Agent mail paths
AGENT_MAIL_PATH = REPO_ROOT / ".agent-mail"
COMMANDS_PATH = AGENT_MAIL_PATH / "commands"
RESULTS_PATH = AGENT_MAIL_PATH / "results"

# Server configuration
PORT = int(os.environ.get("PORT", 8888))

# Skills configuration
SKILLS_DIR = Path(__file__).parent.parent.parent / "skills"
DEFAULT_SKILLS = ["team-coord", "workflow", "agent-monitor"]


def update_paths(project_root: Path):
    """Update global paths when project changes."""
    global REPO_ROOT, AGENT_MAIL_PATH, COMMANDS_PATH, RESULTS_PATH
    REPO_ROOT = project_root
    AGENT_MAIL_PATH = REPO_ROOT / ".agent-mail"
    COMMANDS_PATH = AGENT_MAIL_PATH / "commands"
    RESULTS_PATH = AGENT_MAIL_PATH / "results"

    # Ensure directories exist
    COMMANDS_PATH.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.mkdir(parents=True, exist_ok=True)
