"""File system watcher for agent-mail and session directories."""

import asyncio
import json
import re
import time
from pathlib import Path
from typing import Callable, Optional

import frontmatter
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer


class AgentMailHandler(FileSystemEventHandler):
    """Handle file system events in .agent-mail directory."""

    def __init__(self, broadcast_callback: Callable, agent_mail_path: Path):
        self.broadcast = broadcast_callback
        self.agent_mail_path = agent_mail_path
        self._loop = None

    def set_loop(self, loop):
        """Set the asyncio event loop for callbacks."""
        self._loop = loop

    def _schedule_broadcast(self, message: dict):
        """Schedule async broadcast from sync context."""
        if self._loop:
            asyncio.run_coroutine_threadsafe(self.broadcast(message), self._loop)

    def on_modified(self, event):
        if event.is_directory:
            return

        path = Path(event.src_path)

        # State file changed
        if path.name == "state.json":
            try:
                state = json.loads(path.read_text())
                self._schedule_broadcast({
                    "type": "state",
                    "data": state
                })
            except Exception as e:
                print(f"Error parsing state.json: {e}")

    def on_created(self, event):
        if event.is_directory:
            return

        path = Path(event.src_path)

        # New output JSON
        if path.name.endswith("-output.json"):
            self._handle_output_file(path)

        # New result markdown
        elif path.name.endswith("-result.md"):
            self._handle_result_file(path)

        # Peer request (Phase 5D)
        elif "peer-requests" in str(path) and path.suffix == ".json":
            self._handle_peer_request(path)

    def _handle_output_file(self, path: Path):
        """Parse and broadcast agent output JSON."""
        try:
            data = json.loads(path.read_text())

            # Extract agent name from path
            agent = path.parent.name

            # Extract key info
            message = {
                "type": "output",
                "data": {
                    "agent": agent,
                    "file": path.name,
                    "is_error": data.get("is_error", False),
                    "duration_ms": data.get("duration_ms"),
                    "num_turns": data.get("num_turns"),
                    "result": data.get("result", "")[:500],  # Truncate
                    "cost_usd": data.get("total_cost_usd"),
                    "usage": data.get("usage", {})
                }
            }
            self._schedule_broadcast(message)
        except Exception as e:
            print(f"Error parsing output file {path}: {e}")

    def _handle_result_file(self, path: Path):
        """Parse and broadcast agent result markdown."""
        try:
            content = path.read_text()
            post = frontmatter.loads(content)

            # Extract metadata from frontmatter
            agent = post.get("agent", path.parent.name)
            status = post.get("status", "unknown")
            needs = post.get("needs", [])
            timestamp = post.get("timestamp", 0)

            # Extract summary from content
            summary = ""
            if "## Summary" in post.content:
                match = re.search(r"## Summary\s*\n(.*?)(?=\n##|\Z)", post.content, re.DOTALL)
                if match:
                    summary = match.group(1).strip()[:300]

            # Extract files changed
            files_changed = []
            if "## Files Changed" in post.content:
                match = re.search(r"## Files Changed\s*\n(.*?)(?=\n##|\Z)", post.content, re.DOTALL)
                if match:
                    files_changed = [
                        line.strip().lstrip("- ")
                        for line in match.group(1).strip().split("\n")
                        if line.strip()
                    ][:20]  # Limit to 20 files

            message = {
                "type": "result",
                "data": {
                    "agent": agent,
                    "status": status,
                    "needs": needs,
                    "timestamp": timestamp,
                    "summary": summary,
                    "files_changed": files_changed,
                    "file": path.name
                }
            }
            self._schedule_broadcast(message)
        except Exception as e:
            print(f"Error parsing result file {path}: {e}")

    def _handle_peer_request(self, path: Path):
        """Parse and broadcast peer request (Phase 5D)."""
        try:
            data = json.loads(path.read_text())

            message = {
                "type": "peer_request",
                "data": {
                    "id": data.get("id"),
                    "from": data.get("from"),
                    "to": data.get("to"),
                    "request": data.get("request", "")[:500],
                    "status": data.get("status"),
                    "created_at": data.get("created_at"),
                    "file": path.name
                }
            }
            self._schedule_broadcast(message)
        except Exception as e:
            print(f"Error parsing peer request {path}: {e}")


class SessionHandler(FileSystemEventHandler):
    """Handle file system events for Claude session files."""

    def __init__(self, broadcast_callback: Callable):
        self.broadcast = broadcast_callback
        self._loop = None
        self._last_broadcast: dict[str, float] = {}  # Debounce per session
        self._debounce_ms = 500  # 500ms debounce

    def set_loop(self, loop):
        """Set the asyncio event loop for callbacks."""
        self._loop = loop

    def _schedule_broadcast(self, message: dict):
        """Schedule async broadcast from sync context."""
        if self._loop:
            asyncio.run_coroutine_threadsafe(self.broadcast(message), self._loop)

    def on_modified(self, event):
        if event.is_directory:
            return

        path = Path(event.src_path)

        # Only watch .jsonl session files
        if path.suffix == '.jsonl':
            session_id = path.stem
            now = time.time() * 1000

            # Debounce - don't broadcast if we just did for this session
            last = self._last_broadcast.get(session_id, 0)
            if now - last < self._debounce_ms:
                return

            self._last_broadcast[session_id] = now

            # Broadcast session update
            self._schedule_broadcast({
                "type": "session_update",
                "data": {
                    "session_id": session_id,
                    "path": str(path),
                    "timestamp": int(now),
                }
            })


class AgentMailWatcher:
    """Watch the .agent-mail directory for changes."""

    def __init__(self, agent_mail_path: Path, broadcast_callback: Callable):
        self.path = agent_mail_path
        self.handler = AgentMailHandler(broadcast_callback, agent_mail_path)
        self.observer = Observer()

    def start(self, loop):
        """Start watching the directory."""
        self.handler.set_loop(loop)
        self.observer.schedule(self.handler, str(self.path), recursive=True)
        self.observer.start()
        print(f"Watching: {self.path}")

    def stop(self):
        """Stop watching."""
        self.observer.stop()
        self.observer.join()


class SessionWatcher:
    """Watch Claude session directories for changes."""

    def __init__(self, broadcast_callback: Callable):
        self.broadcast = broadcast_callback
        self.handler = SessionHandler(broadcast_callback)
        self.observer = Observer()
        self.watched_paths: list[str] = []

    def add_path(self, path: Path):
        """Add a session directory to watch."""
        if path.exists() and str(path) not in self.watched_paths:
            self.observer.schedule(self.handler, str(path), recursive=False)
            self.watched_paths.append(str(path))
            print(f"Watching sessions: {path}")

    def start(self, loop):
        """Start watching."""
        self.handler.set_loop(loop)
        self.observer.start()

    def stop(self):
        """Stop watching."""
        self.observer.stop()
        self.observer.join()
