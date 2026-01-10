"""File system watcher for agent-mail directory."""

import asyncio
import json
import re
from pathlib import Path
from typing import Callable

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
