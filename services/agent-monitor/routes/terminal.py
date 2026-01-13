"""Terminal WebSocket endpoint with PTY support."""

import asyncio
import os
import pty
import select
import struct
import fcntl
import termios
import signal
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import database as db

router = APIRouter(tags=["terminal"])

# Store active PTY sessions
pty_sessions: dict[str, dict] = {}


@router.websocket("/ws/terminal/{terminal_id}")
async def terminal_websocket(websocket: WebSocket, terminal_id: str):
    """WebSocket endpoint for interactive terminal with PTY."""
    await websocket.accept()
    print(f"[TERMINAL] WebSocket connected: {terminal_id}")

    # Get working directory from active project
    project = db.get_active_project()
    cwd = project["root_path"] if project else str(Path.home())

    # Create PTY
    master_fd, slave_fd = pty.openpty()

    # Fork a shell process
    pid = os.fork()
    if pid == 0:
        # Child process
        os.close(master_fd)
        os.setsid()
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        os.close(slave_fd)
        os.chdir(cwd)

        # Set environment
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"

        # Execute shell
        shell = os.environ.get("SHELL", "/bin/bash")
        os.execvpe(shell, [shell], env)

    # Parent process
    os.close(slave_fd)

    # Set non-blocking
    flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    # Store session
    pty_sessions[terminal_id] = {
        "master_fd": master_fd,
        "pid": pid,
        "cwd": cwd
    }

    async def read_pty():
        """Read from PTY and send to WebSocket."""
        loop = asyncio.get_event_loop()
        while True:
            try:
                # Use select to check if data is available
                await loop.run_in_executor(
                    None,
                    lambda: select.select([master_fd], [], [], 0.1)
                )

                try:
                    data = os.read(master_fd, 4096)
                    if data:
                        await websocket.send_bytes(data)
                except (OSError, BlockingIOError):
                    pass

                await asyncio.sleep(0.01)
            except Exception as e:
                print(f"[TERMINAL] Read error: {e}")
                break

    async def write_pty():
        """Read from WebSocket and write to PTY."""
        while True:
            try:
                message = await websocket.receive()

                if message["type"] == "websocket.disconnect":
                    break

                if "bytes" in message:
                    data = message["bytes"]
                    os.write(master_fd, data)
                elif "text" in message:
                    text = message["text"]
                    # Handle resize message
                    if text.startswith("resize:"):
                        try:
                            _, cols, rows = text.split(":")
                            cols, rows = int(cols), int(rows)
                            winsize = struct.pack("HHHH", rows, cols, 0, 0)
                            fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
                        except Exception as e:
                            print(f"[TERMINAL] Resize error: {e}")
                    else:
                        os.write(master_fd, text.encode())

            except WebSocketDisconnect:
                break
            except Exception as e:
                print(f"[TERMINAL] Write error: {e}")
                break

    try:
        # Run read and write tasks concurrently
        read_task = asyncio.create_task(read_pty())
        write_task = asyncio.create_task(write_pty())

        done, pending = await asyncio.wait(
            [read_task, write_task],
            return_when=asyncio.FIRST_COMPLETED
        )

        # Cancel pending tasks gracefully
        for task in pending:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass  # Expected when cancelling

    except Exception as e:
        print(f"[TERMINAL] Error: {e}")

    finally:
        # Cleanup
        print(f"[TERMINAL] Cleaning up: {terminal_id}")
        if terminal_id in pty_sessions:
            session = pty_sessions.pop(terminal_id)
            try:
                os.close(session["master_fd"])
            except:
                pass
            try:
                os.kill(session["pid"], signal.SIGTERM)
                os.waitpid(session["pid"], os.WNOHANG)
            except:
                pass


@router.post("/api/terminal/{terminal_id}/resize")
async def resize_terminal(terminal_id: str, cols: int, rows: int):
    """Resize terminal."""
    if terminal_id not in pty_sessions:
        return {"error": "Terminal not found"}

    session = pty_sessions[terminal_id]
    try:
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(session["master_fd"], termios.TIOCSWINSZ, winsize)
        return {"success": True}
    except Exception as e:
        return {"error": str(e)}
