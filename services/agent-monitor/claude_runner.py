"""Claude Code process runner for interactive chat."""

import asyncio
import base64
import json
import os
import re
import tempfile
from pathlib import Path
from typing import AsyncGenerator, Callable, Optional

import pexpect

# Configuration
REPO_ROOT = Path(os.environ.get("REPO_ROOT", "/home/frankyin/Desktop/lab/fluxa"))
LAB_DIR = REPO_ROOT.parent

# Agent to working directory mapping
AGENT_WORKDIRS = {
    "leader": REPO_ROOT,
    "api": LAB_DIR / "fluxa-api",
    "mobile": LAB_DIR / "fluxa-mobile",
    "admin": LAB_DIR / "fluxa-admin",
    "pipeline": LAB_DIR / "fluxa-pipeline",
    "services": LAB_DIR / "fluxa-services",
}

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

    def __init__(self, agent: str = "leader"):
        self.agent = agent
        self.workdir = AGENT_WORKDIRS.get(agent, REPO_ROOT)
        self.child: Optional[pexpect.spawn] = None
        self._running = False
        self._input_queue: asyncio.Queue = asyncio.Queue()
        self._pending_permission = False

    async def run_chat(
        self,
        message: str,
        session_id: Optional[str] = None,
        resume: bool = True,
        images: Optional[list[str]] = None,
        mode: str = "normal",
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

        # Add images first (before prompt)
        for img_path in temp_image_paths:
            cmd_parts.extend(["--image", img_path])

        # Add prompt
        cmd_parts.extend(["-p", message])

        # Add resume flag - prefer explicit session_id, otherwise --continue
        if session_id:
            cmd_parts.extend(["--resume", session_id])
        elif resume:
            cmd_parts.append("--continue")

        # Use stream-json for real-time output (requires --verbose with -p)
        cmd_parts.extend(["--output-format", "stream-json", "--verbose"])

        # Apply mode-specific flags
        if mode == "yolo":
            # YOLO mode: skip all permission prompts
            cmd_parts.append("--dangerously-skip-permissions")
        elif mode == "auto":
            # Auto edit mode: auto-accept file edits
            cmd_parts.extend(["--allowedTools", "Edit,Write,Bash,Read,Glob,Grep"])
        elif mode == "plan":
            # Plan mode: only allow read operations initially
            cmd_parts.extend(["--allowedTools", "Read,Glob,Grep,Task"])
        # Normal mode: no extra flags, will prompt for permissions

        # Set max turns to prevent runaway
        cmd_parts.extend(["--max-turns", "50"])

        cmd = ' '.join(cmd_parts)

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

        # Tool permission: "Allow Edit to modify file.txt?"
        match = re.search(r'allow\s+(\w+)\s+to\s+(.+?)\?', text_lower)
        if match:
            tool = match.group(1).capitalize()
            action = match.group(2)
            return {
                "type": "permission_request",
                "prompt": text,
                "tool": tool,
                "action": action,
                "options": ["Yes", "No", "Always allow this session"]
            }

        # Yes/No prompt
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

    def get_runner(self, session_id: str, agent: str = "leader") -> ClaudeRunner:
        """Get or create a runner for a session."""
        if session_id not in self.sessions:
            self.sessions[session_id] = ClaudeRunner(agent)
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
