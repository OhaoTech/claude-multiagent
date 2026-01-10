"""Session reader for Claude Code session files."""

import json
from datetime import datetime
from pathlib import Path
from typing import Optional

from models import SessionInfo, SessionMessage


def path_to_claude_dir_name(path: str) -> str:
    """Convert a filesystem path to Claude's project directory naming convention.

    e.g., /home/frankyin/lab/myproject -> -home-frankyin-lab-myproject
    """
    return path.replace("/", "-").replace("\\", "-")


def get_project_sessions_dirs(project_root: str, agents: list[dict] = None) -> list[tuple[Path, str]]:
    """Get Claude project directories for a specific project and its agents.

    Args:
        project_root: The root path of the project
        agents: List of agent dicts with 'name' and 'worktree_path' keys (from database)

    Returns list of (path, agent_name) tuples.
    """
    home = Path.home()
    projects_dir = home / ".claude" / "projects"

    if not projects_dir.exists():
        return []

    # Build a mapping of worktree paths to agent names
    # Sort by path length (longest first) so more specific paths match first
    worktree_to_agent = {}
    if agents:
        for agent in agents:
            worktree_path = agent.get("worktree_path")
            if worktree_path:
                # Convert worktree path to Claude directory pattern
                pattern = path_to_claude_dir_name(worktree_path)
                worktree_to_agent[pattern] = agent.get("name", "leader")

    # Also add the main project root for leader
    main_pattern = path_to_claude_dir_name(project_root)
    if main_pattern not in worktree_to_agent:
        worktree_to_agent[main_pattern] = "leader"

    # Sort patterns by length (longest first) for correct matching
    sorted_patterns = sorted(worktree_to_agent.items(), key=lambda x: len(x[0]), reverse=True)

    result = []

    for p in projects_dir.iterdir():
        if not p.is_dir():
            continue

        # Check if this directory matches any of our known paths
        # Use exact match: directory name must equal pattern exactly
        agent_name = None
        for pattern, name in sorted_patterns:
            # Exact match - the directory name should be exactly the pattern
            if p.name == pattern:
                agent_name = name
                break

        if agent_name:
            result.append((p, agent_name))

    return result


def get_all_project_dirs() -> list[tuple[Path, str]]:
    """Get all Claude project directories (legacy - returns all).

    Returns list of (path, agent_name) tuples.
    """
    home = Path.home()
    projects_dir = home / ".claude" / "projects"

    if not projects_dir.exists():
        return []

    result = []

    for p in projects_dir.iterdir():
        if not p.is_dir():
            continue

        # Default to "leader" - we can't determine agent without project context
        result.append((p, "leader"))

    return result


def parse_session_file(filepath: Path) -> Optional[SessionInfo]:
    """Parse a session JSONL file and extract metadata.

    Looks for messages in:
    1. The main session .jsonl file
    2. The subagents folder: {session_id}/subagents/agent-*.jsonl
    """
    try:
        messages = []
        first_timestamp = None
        last_timestamp = None
        session_id = filepath.stem
        agent_id = None
        total_cost = 0.0
        cwd = None

        # Collect all files to parse: main file + subagent files
        files_to_parse = [filepath]

        # Check for subagents folder
        subagents_dir = filepath.parent / session_id / "subagents"
        if subagents_dir.exists():
            for subagent_file in subagents_dir.glob("agent-*.jsonl"):
                files_to_parse.append(subagent_file)

        for parse_file in files_to_parse:
            with open(parse_file, 'r') as f:
                for line in f:
                    try:
                        entry = json.loads(line.strip())

                        # Extract session metadata from first entry
                        if not agent_id and entry.get('agentId'):
                            agent_id = entry['agentId']
                        if not cwd and entry.get('cwd'):
                            cwd = entry['cwd']

                        # Track timestamps
                        ts = entry.get('timestamp')
                        if ts:
                            if isinstance(ts, str):
                                try:
                                    dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
                                    ts_unix = dt.timestamp()
                                except:
                                    ts_unix = None
                            else:
                                ts_unix = ts / 1000 if ts > 1e12 else ts

                            if ts_unix:
                                if first_timestamp is None or ts_unix < first_timestamp:
                                    first_timestamp = ts_unix
                                if last_timestamp is None or ts_unix > last_timestamp:
                                    last_timestamp = ts_unix

                        # Count messages and extract cost
                        msg_type = entry.get('type')
                        if msg_type in ('user', 'assistant'):
                            messages.append(entry)

                        # Extract cost from usage data
                        if 'message' in entry and isinstance(entry['message'], dict):
                            usage = entry['message'].get('usage', {})
                            input_tokens = usage.get('input_tokens', 0)
                            output_tokens = usage.get('output_tokens', 0)
                            cache_read = usage.get('cache_read_input_tokens', 0)
                            cache_write = usage.get('cache_creation_input_tokens', 0)
                            total_cost += (input_tokens * 0.003 + output_tokens * 0.015 +
                                          cache_read * 0.0003 + cache_write * 0.00375) / 1000

                    except json.JSONDecodeError:
                        continue

        if not messages:
            return None

        # Agent is determined by the caller based on worktree path matching
        agent = "leader"  # default - will be overridden by caller if needed

        # Get last message preview
        last_msg = ""
        for msg in reversed(messages):
            content = msg.get('message', {})
            if isinstance(content, dict):
                c = content.get('content', '')
                if isinstance(c, str):
                    last_msg = c[:100]
                    break
                elif isinstance(c, list):
                    for item in c:
                        if isinstance(item, dict) and item.get('type') == 'text':
                            last_msg = item.get('text', '')[:100]
                            break
                    if last_msg:
                        break

        return SessionInfo(
            session_id=session_id,
            agent_id=agent_id or "",
            agent=agent,
            message_count=len(messages),
            first_timestamp=first_timestamp,
            last_timestamp=last_timestamp,
            cost_usd=round(total_cost, 4),
            last_message_preview=last_msg,
            cwd=cwd or ""
        )

    except Exception as e:
        print(f"Error parsing session {filepath}: {e}")
        return None


def get_all_sessions(project_root: str = None, agents: list[dict] = None) -> list[SessionInfo]:
    """Get all sessions, optionally filtered by project root path and agents.

    Args:
        project_root: The root path of the project to filter by
        agents: List of agent dicts with 'name' and 'worktree_path' keys (from database)
    """
    sessions = []

    # Use project-specific dirs if project_root is provided
    if project_root:
        project_dirs = get_project_sessions_dirs(project_root, agents)
    else:
        project_dirs = get_all_project_dirs()

    for project_dir, default_agent in project_dirs:
        if not project_dir.exists():
            continue

        for filepath in project_dir.glob("*.jsonl"):
            # Skip agent-specific files (they have "agent-" prefix)
            if filepath.name.startswith("agent-"):
                continue

            session = parse_session_file(filepath)
            if session:
                # Override agent if it's still "leader" and we know the directory
                if session.agent == "leader" and default_agent != "leader":
                    session.agent = default_agent
                sessions.append(session)

    # Sort by last timestamp (most recent first)
    sessions.sort(key=lambda s: s.last_timestamp or 0, reverse=True)
    return sessions


def get_sessions_for_agent(agent: str, project_root: str = None, agents: list[dict] = None) -> list[SessionInfo]:
    """Get sessions filtered by agent name, optionally within a specific project."""
    all_sessions = get_all_sessions(project_root, agents)
    return [s for s in all_sessions if s.agent == agent]


def get_session_messages(session_id: str) -> list[SessionMessage]:
    """Get all messages for a specific session."""
    # Search all project directories for this session
    filepath = None
    for project_dir, _ in get_all_project_dirs():
        candidate = project_dir / f"{session_id}.jsonl"
        if candidate.exists():
            filepath = candidate
            break

    if not filepath:
        return []

    messages = []

    with open(filepath, 'r') as f:
        for line in f:
            try:
                entry = json.loads(line.strip())
                msg_type = entry.get('type')

                # Include user, assistant, system, tool_result, and summary
                if msg_type not in ('user', 'assistant', 'system', 'tool_result', 'summary'):
                    continue

                # Extract content
                content = ""
                message_data = entry.get('message', {})

                # Handle tool_result specially
                if msg_type == 'tool_result':
                    tool_id = entry.get('tool_use_id', '')
                    result_content = entry.get('content', '')
                    if isinstance(result_content, list):
                        parts = []
                        for item in result_content:
                            if isinstance(item, dict) and item.get('type') == 'text':
                                parts.append(item.get('text', ''))
                        result_content = '\n'.join(parts)
                    # Truncate long results
                    if len(str(result_content)) > 500:
                        result_content = str(result_content)[:500] + '...[truncated]'
                    content = f"[Result] {result_content}"
                elif msg_type == 'summary':
                    content = f"[Summary] {entry.get('summary', '')}"
                elif isinstance(message_data, dict):
                    c = message_data.get('content', '')
                    if isinstance(c, str):
                        content = c
                    elif isinstance(c, list):
                        parts = []
                        for item in c:
                            if isinstance(item, dict):
                                item_type = item.get('type', '')
                                if item_type == 'text':
                                    parts.append(item.get('text', ''))
                                elif item_type == 'tool_use':
                                    tool_name = item.get('name', 'tool')
                                    tool_input = item.get('input', {})
                                    # Show key param for common tools
                                    param = ''
                                    if isinstance(tool_input, dict):
                                        param = tool_input.get('command') or tool_input.get('pattern') or tool_input.get('file_path') or tool_input.get('query') or ''
                                        if param and len(param) > 60:
                                            param = param[:60] + '...'
                                    parts.append(f"[Tool: {tool_name}] {param}")
                                elif item_type == 'tool_result':
                                    # Tool result embedded in user message
                                    result_content = item.get('content', '')
                                    if isinstance(result_content, str) and result_content:
                                        # Truncate long results
                                        if len(result_content) > 300:
                                            result_content = result_content[:300] + '...'
                                        parts.append(f"[Result] {result_content}")
                        content = '\n'.join(parts)

                # Parse timestamp
                ts = entry.get('timestamp')
                timestamp = None
                if ts:
                    if isinstance(ts, str):
                        try:
                            dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
                            timestamp = dt.timestamp()
                        except:
                            pass
                    else:
                        timestamp = ts / 1000 if ts > 1e12 else ts

                # Extract usage/cost
                usage = message_data.get('usage', {}) if isinstance(message_data, dict) else {}

                messages.append(SessionMessage(
                    type=msg_type,
                    content=content,
                    timestamp=timestamp,
                    uuid=entry.get('uuid', ''),
                    model=message_data.get('model') if isinstance(message_data, dict) else None,
                    usage=usage if usage else None
                ))

            except json.JSONDecodeError:
                continue

    return messages
