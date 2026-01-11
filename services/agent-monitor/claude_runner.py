"""Claude Code process runner for interactive chat."""

import asyncio
import base64
import json
import os
import re
import shlex
import tempfile
from pathlib import Path
from typing import AsyncGenerator, Callable, Optional

import pexpect

import database as db

# Permission prompt patterns
PERMISSION_PATTERNS = [
    # Tool permission prompts
    (r'Allow (\w+) to (.+?)\?', 'tool_permission'),
    # Yes/No prompts
    (r'\[([Yy]/[Nn])\]', 'yes_no'),
    # Press Enter to continue
    (r'Press Enter', 'enter_continue'),
    # Plan approval
    (r'Do you want to proceed', 'plan_approval'),
    # Multiple choice (numbered options)
    (r'(\d+)\.\s+(.+?)(?:\n|$)', 'choice'),
]


class ClaudeRunner:
    """Manages Claude Code subprocess for interactive chat with PTY support."""

    def __init__(self, agent: str = "leader", project_root: Optional[Path] = None):
        self.agent = agent
        self.project_root = project_root
        self.workdir = self._resolve_workdir()
        self.child: Optional[pexpect.spawn] = None
        self._running = False
        self._input_queue: asyncio.Queue = asyncio.Queue()
        self._pending_permission = False

    def _resolve_workdir(self) -> Path:
        """Resolve the working directory for the agent based on project and agent config."""
        # If project_root is provided, use it
        if self.project_root:
            # For leader, use project root directly
            if self.agent == "leader":
                return self.project_root

            # For other agents, check if they have a worktree path in DB
            project = db.get_active_project()
            if project:
                agents = db.list_agents(project["id"])
                for a in agents:
                    if a["name"] == self.agent and a.get("worktree_path"):
                        return Path(a["worktree_path"])

            # Fallback to project root
            return self.project_root

        # Fallback: get active project from database
        project = db.get_active_project()
        if project:
            project_root = Path(project["root_path"])

            if self.agent == "leader":
                return project_root

            # Check for agent's worktree path
            agents = db.list_agents(project["id"])
            for a in agents:
                if a["name"] == self.agent and a.get("worktree_path"):
                    return Path(a["worktree_path"])

            return project_root

        # Ultimate fallback
        return Path.home()

    async def run_chat(
        self,
        message: str,
        session_id: Optional[str] = None,
        resume: bool = True,
        images: Optional[list[str]] = None,
        mode: str = "normal",
        model: str = "sonnet",
        on_output: Optional[Callable[[str], None]] = None
    ) -> AsyncGenerator[dict, None]:
        """
        Run Claude Code with a message and stream output.

        Args:
            message: The user message to send
            session_id: Session ID to resume (optional)
            resume: Whether to use --continue flag
            images: List of base64 data URLs for images
            mode: Operating mode (normal, plan, auto, yolo)
            model: Model to use (haiku, sonnet, opus)
            on_output: Optional callback for each output chunk

        Yields:
            Dict with type and content for each output chunk
        """
        # Save images to temp files if provided
        temp_image_paths = []
        if images:
            for i, data_url in enumerate(images):
                try:
                    # Parse data URL: data:image/png;base64,xxxxx
                    if data_url.startswith('data:'):
                        header, data = data_url.split(',', 1)
                        # Extract mime type for extension
                        mime = header.split(';')[0].split(':')[1]
                        ext = mime.split('/')[-1]
                        if ext == 'jpeg':
                            ext = 'jpg'
                    else:
                        data = data_url
                        ext = 'png'

                    # Decode and save
                    img_data = base64.b64decode(data)
                    temp_path = Path(tempfile.gettempdir()) / f"claude_img_{os.getpid()}_{i}.{ext}"
                    temp_path.write_bytes(img_data)
                    temp_image_paths.append(str(temp_path))
                    print(f"[RUNNER] Saved image {i} to {temp_path}")
                except Exception as e:
                    print(f"[RUNNER] Failed to save image {i}: {e}")

        # Build command
        cmd_parts = ["claude"]

        # Add model selection
        if model and model in ("haiku", "sonnet", "opus"):
            cmd_parts.extend(["--model", model])

        # Add images first (before prompt)
        for img_path in temp_image_paths:
            cmd_parts.extend(["--image", img_path])

        # Add prompt
        cmd_parts.extend(["-p", message])

        # Add resume flag - only use --resume if resume=True AND we have a session_id
        if resume and session_id:
            cmd_parts.extend(["--resume", session_id])
        elif resume:
            # Resume without specific session - use --continue for last session
            cmd_parts.append("--continue")

        # Apply mode-specific flags
        if mode == "yolo":
            # YOLO mode: skip all permission prompts, use stream-json
            cmd_parts.append("--dangerously-skip-permissions")
            cmd_parts.extend(["--output-format", "stream-json", "--verbose"])
        elif mode == "auto":
            # Auto edit mode: auto-accept file edits, use stream-json
            cmd_parts.extend(["--allowedTools", "Edit,Write,Bash,Read,Glob,Grep"])
            cmd_parts.extend(["--output-format", "stream-json", "--verbose"])
        elif mode == "plan":
            # Plan mode: only allow read operations, use stream-json
            cmd_parts.extend(["--allowedTools", "Read,Glob,Grep,Task"])
            cmd_parts.extend(["--output-format", "stream-json", "--verbose"])
        else:
            # Normal mode: no stream-json, use raw PTY for interactive permission prompts
            # Add verbose for detailed output
            cmd_parts.append("--verbose")

        # Set max turns to prevent runaway
        cmd_parts.extend(["--max-turns", "50"])

        # Build command string with proper shell quoting
        cmd = ' '.join(shlex.quote(part) for part in cmd_parts)

        try:
            self._running = True
            print(f"[RUNNER] Starting: {cmd}")
            print(f"[RUNNER] Working dir: {self.workdir}")
            print(f"[RUNNER] Mode: {mode}")

            # Use PTY for interactive mode (normal), subprocess for others
            if mode == "normal":
                async for event in self._run_with_pty(cmd, temp_image_paths, on_output):
                    yield event
            else:
                async for event in self._run_with_subprocess(cmd_parts, temp_image_paths, on_output):
                    yield event

        except asyncio.CancelledError:
            await self.stop()
            yield {"type": "cancelled"}

        except Exception as e:
            print(f"[RUNNER] Error: {e}")
            yield {"type": "error", "message": str(e)}

        finally:
            self._running = False
            self.child = None
            # Clean up temp images
            for img_path in temp_image_paths:
                try:
                    Path(img_path).unlink(missing_ok=True)
                except Exception:
                    pass

    async def _run_with_pty(
        self,
        cmd: str,
        temp_image_paths: list,
        on_output: Optional[Callable[[str], None]]
    ) -> AsyncGenerator[dict, None]:
        """Run with PTY for interactive prompts."""
        # Spawn with pexpect
        self.child = pexpect.spawn(
            cmd,
            cwd=str(self.workdir),
            env={**os.environ, "NO_COLOR": "1", "TERM": "dumb"},
            encoding='utf-8',
            timeout=300
        )
        print(f"[RUNNER] PTY process started: PID {self.child.pid}")

        # Buffer for accumulating output
        buffer = ""
        line_count = 0

        while self._running and self.child.isalive():
            try:
                # Read available output with short timeout
                chunk = self.child.read_nonblocking(size=4096, timeout=0.1)
                if chunk:
                    buffer += chunk
                    print(f"[RUNNER] Buffer now ({len(buffer)} chars): {buffer[-200:]}")

                    # Check buffer for permission prompts BEFORE waiting for newline
                    # Permission prompts don't end with newline - they wait for input
                    if not self._pending_permission:
                        permission_event = self._check_permission_prompt(buffer)
                        if permission_event:
                            print(f"[RUNNER] Permission prompt in buffer: {buffer[:100]}")
                            self._pending_permission = True
                            # Clear the buffer since we're handling the prompt
                            buffer = ""
                            yield permission_event

                            # Wait for user response
                            try:
                                response = await asyncio.wait_for(
                                    self._input_queue.get(),
                                    timeout=300  # 5 min timeout for user response
                                )
                                print(f"[RUNNER] Sending response: {response}")
                                self.child.sendline(response)
                                self._pending_permission = False
                                yield {"type": "permission_response_sent", "response": response}
                            except asyncio.TimeoutError:
                                print("[RUNNER] Permission response timeout")
                                yield {"type": "error", "message": "Permission response timeout"}
                                break
                            continue

                    # Process complete lines
                    while '\n' in buffer:
                        line, buffer = buffer.split('\n', 1)
                        line = line.strip()
                        if not line:
                            continue

                        line_count += 1

                        # Check for permission prompts in raw output
                        permission_event = self._check_permission_prompt(line)
                        if permission_event:
                            print(f"[RUNNER] Permission prompt detected: {line[:80]}")
                            self._pending_permission = True
                            yield permission_event

                            # Wait for user response
                            try:
                                response = await asyncio.wait_for(
                                    self._input_queue.get(),
                                    timeout=300  # 5 min timeout for user response
                                )
                                print(f"[RUNNER] Sending response: {response}")
                                self.child.sendline(response)
                                self._pending_permission = False
                                yield {"type": "permission_response_sent", "response": response}
                            except asyncio.TimeoutError:
                                print("[RUNNER] Permission response timeout")
                                yield {"type": "error", "message": "Permission response timeout"}
                                break
                            continue

                        # Try to parse as JSON (stream-json output)
                        try:
                            data = json.loads(line)
                            print(f"[RUNNER] Line {line_count}: {line[:100]}...")

                            # Check for permission patterns in assistant messages
                            permission_event = self._check_json_permission(data)
                            if permission_event:
                                print(f"[RUNNER] Permission detected in JSON message")
                                self._pending_permission = True
                                yield permission_event

                                # Wait for user response
                                try:
                                    response = await asyncio.wait_for(
                                        self._input_queue.get(),
                                        timeout=300
                                    )
                                    print(f"[RUNNER] Sending response: {response}")
                                    self.child.sendline(response)
                                    self._pending_permission = False
                                    yield {"type": "permission_response_sent", "response": response}
                                except asyncio.TimeoutError:
                                    print("[RUNNER] Permission response timeout")
                                    yield {"type": "error", "message": "Permission response timeout"}
                                    break
                                continue

                            yield data
                            if on_output:
                                on_output(line)
                        except json.JSONDecodeError:
                            # Non-JSON output - could be prompt or other text
                            print(f"[RUNNER] Non-JSON: {line[:100]}")
                            yield {"type": "raw", "content": line}

            except pexpect.TIMEOUT:
                # Check if we're waiting for permission
                if self._pending_permission:
                    await asyncio.sleep(0.1)
                    continue
                # No output available, brief pause
                await asyncio.sleep(0.05)

            except pexpect.EOF:
                print("[RUNNER] EOF reached")
                break

            except Exception as e:
                print(f"[RUNNER] Read error: {e}")
                break

        # Process remaining buffer
        if buffer.strip():
            try:
                data = json.loads(buffer.strip())
                yield data
            except json.JSONDecodeError:
                yield {"type": "raw", "content": buffer.strip()}

        # Get exit status
        self.child.close()
        exit_code = self.child.exitstatus or 0
        print(f"[RUNNER] Process exited with code: {exit_code}")

        yield {"type": "done", "exit_code": exit_code}

    async def _run_with_subprocess(
        self,
        cmd_parts: list,
        temp_image_paths: list,
        on_output: Optional[Callable[[str], None]]
    ) -> AsyncGenerator[dict, None]:
        """Run with subprocess (no interactive prompts)."""
        process = await asyncio.create_subprocess_exec(
            *cmd_parts,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(self.workdir),
            env={**os.environ, "NO_COLOR": "1"}
        )
        print(f"[RUNNER] Subprocess started: PID {process.pid}")

        # Stream stdout
        line_count = 0
        if process.stdout:
            async for line in process.stdout:
                if not self._running:
                    print("[RUNNER] Stopped (not running)")
                    break

                line_str = line.decode('utf-8').strip()
                if not line_str:
                    continue

                line_count += 1
                print(f"[RUNNER] Line {line_count}: {line_str[:100]}...")

                try:
                    data = json.loads(line_str)
                    yield data
                    if on_output:
                        on_output(line_str)
                except json.JSONDecodeError:
                    print(f"[RUNNER] Non-JSON: {line_str}")
                    yield {"type": "raw", "content": line_str}

        # Wait for completion
        await process.wait()
        print(f"[RUNNER] Process exited with code: {process.returncode}")

        yield {"type": "done", "exit_code": process.returncode}

    def _check_permission_prompt(self, text: str) -> Optional[dict]:
        """Check if text contains a permission prompt and return event if so."""
        text_lower = text.lower()

        # Claude CLI tool permission: "Allow Write to create /path/file?"
        # Also matches: "(Y)es / (N)o / (A)lways"
        match = re.search(r'allow\s+(\w+)\s+to\s+(.+?)\?', text_lower)
        if match:
            tool = match.group(1).capitalize()
            action = match.group(2)
            # Check for options in the prompt
            options = ["Yes", "No"]
            if '(a)lways' in text_lower or 'always' in text_lower:
                options.append("Always")
            return {
                "type": "permission_request",
                "prompt": text,
                "tool": tool,
                "action": action,
                "options": options
            }

        # Claude CLI options format: "(Y)es / (N)o / (A)lways"
        if '(y)es' in text_lower and '(n)o' in text_lower:
            options = ["Yes", "No"]
            if '(a)lways' in text_lower:
                options.append("Always")
            return {
                "type": "permission_request",
                "prompt": text,
                "options": options
            }

        # Yes/No prompt variations
        if '[y/n]' in text_lower or '(y/n)' in text_lower:
            return {
                "type": "permission_request",
                "prompt": text,
                "options": ["y", "n"]
            }

        # Press Enter to continue
        if 'press enter' in text_lower:
            return {
                "type": "permission_request",
                "prompt": text,
                "options": ["Continue"]
            }

        # Plan approval
        if 'do you want to proceed' in text_lower or 'approve this plan' in text_lower:
            return {
                "type": "permission_request",
                "prompt": text,
                "options": ["Yes", "No"]
            }

        # Bash command confirmation
        if 'run this command' in text_lower or 'execute this' in text_lower:
            return {
                "type": "permission_request",
                "prompt": text,
                "options": ["Yes", "No"]
            }

        return None

    def _check_json_permission(self, data: dict) -> Optional[dict]:
        """Check if a JSON message contains a permission request pattern."""
        # Extract text content from assistant messages
        text = ""

        # Handle assistant message format: {"type": "assistant", "message": {"content": [...]}}
        if data.get("type") == "assistant":
            message = data.get("message", {})
            content = message.get("content", [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        text += block.get("text", "") + " "
            elif isinstance(content, str):
                text = content

        # Handle result format that might contain permission prompts
        if data.get("type") == "result":
            text = str(data.get("result", ""))

        if not text:
            return None

        text_lower = text.lower()

        # Check for common permission request patterns
        permission_patterns = [
            (r'may i proceed', 'proceed'),
            (r'do you want me to', 'action'),
            (r'should i (create|write|modify|delete|execute|run)', 'action'),
            (r'do you approve', 'approval'),
            (r'is this okay', 'confirmation'),
            (r'can i proceed', 'proceed'),
            (r'shall i', 'action'),
        ]

        for pattern, action_type in permission_patterns:
            if re.search(pattern, text_lower):
                # Extract a preview of what's being asked
                preview = text[:200].strip()
                if len(text) > 200:
                    preview += "..."

                return {
                    "type": "permission_request",
                    "prompt": preview,
                    "action": action_type,
                    "options": ["Yes", "No"]
                }

        return None

    async def send_input(self, response: str):
        """Send user input to the running process."""
        await self._input_queue.put(response)

    async def stop(self):
        """Stop the running Claude process."""
        self._running = False

        if self.child and self.child.isalive():
            try:
                self.child.terminate(force=True)
            except Exception:
                pass
            self.child = None

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def waiting_for_input(self) -> bool:
        return self._pending_permission


class ChatSessionManager:
    """Manages multiple chat sessions."""

    def __init__(self):
        self.sessions: dict[str, ClaudeRunner] = {}

    def get_runner(self, session_id: str, agent: str = "leader", project_root: Optional[Path] = None) -> ClaudeRunner:
        """Get or create a runner for a session."""
        if session_id not in self.sessions:
            self.sessions[session_id] = ClaudeRunner(agent, project_root)
        return self.sessions[session_id]

    async def stop_session(self, session_id: str):
        """Stop a specific session."""
        if session_id in self.sessions:
            await self.sessions[session_id].stop()
            del self.sessions[session_id]

    async def stop_all(self):
        """Stop all sessions."""
        for session_id in list(self.sessions.keys()):
            await self.stop_session(session_id)


# Global session manager
chat_manager = ChatSessionManager()
