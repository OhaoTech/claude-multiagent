"""Chat endpoints and WebSocket handlers."""

import asyncio
import uuid
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from models import ChatRequest
from claude_runner import ClaudeRunner
import database as db

router = APIRouter(tags=["chat"])

chat_connections: dict[str, WebSocket] = {}


@router.post("/api/chat")
async def start_chat(request: ChatRequest):
    """Start a chat with an agent. Returns a chat_id for WebSocket streaming."""
    chat_id = str(uuid.uuid4())[:8]

    return {
        "chat_id": chat_id,
        "agent": request.agent,
        "message": request.message,
        "resume": request.resume,
        "session_id": request.session_id,
        "ws_url": f"/ws/chat/{chat_id}"
    }


@router.websocket("/ws/chat/{chat_id}")
async def chat_websocket(websocket: WebSocket, chat_id: str):
    """WebSocket endpoint for streaming chat responses with bidirectional communication."""
    await websocket.accept()
    chat_connections[chat_id] = websocket
    print(f"[CHAT] WebSocket connected: {chat_id}")

    runner = None

    try:
        init_data = await websocket.receive_json()
        print(f"[CHAT] Received init: {init_data}")

        agent = init_data.get("agent", "leader")
        message = init_data.get("message", "")
        images = init_data.get("images", [])
        resume = init_data.get("resume", True)
        session_id = init_data.get("session_id")
        mode = init_data.get("mode", "normal")

        # Get model from settings
        settings = db.get_settings()
        model = init_data.get("model") or settings.get("model", "sonnet")

        # For new sessions, don't pass session_id - let Claude create one
        # We'll capture Claude's real session ID from output
        is_new_session = session_id is None
        if is_new_session:
            resume = False
            # Don't generate fake UUID - we'll get real one from Claude

        if not message and not images:
            await websocket.send_json({"type": "error", "message": "No message provided"})
            return

        # Get active project's root path
        project = db.get_active_project()
        project_root = Path(project["root_path"]) if project else None

        runner = ClaudeRunner(agent, project_root)
        print(f"[CHAT] Starting Claude runner for agent={agent}, workdir={runner.workdir}, images={len(images)}, mode={mode}, model={model}, session_id={session_id}, is_new={is_new_session}, resume={resume}")

        await websocket.send_json({
            "type": "chat_start",
            "agent": agent,
            "message": message,
            "image_count": len(images),
            "mode": mode,
            "model": model,
            "session_id": session_id  # Will be None for new sessions
        })

        # Track Claude's real session ID from output
        # If resuming with a known session_id, use that (no need to capture from output)
        real_session_id = session_id if session_id and resume else None
        output_count = 0

        async for output in runner.run_chat(message, session_id, resume, images=images, mode=mode, model=model):
            output_count += 1
            output_type = output.get('type')
            print(f"[CHAT] Output #{output_count}: type={output_type}")

            # Capture real session ID from Claude's output (for new sessions)
            # Claude outputs sessionId in init/system messages (stream-json mode)
            if not real_session_id:
                if output.get('sessionId'):
                    real_session_id = output['sessionId']
                    print(f"[CHAT] Captured real session ID: {real_session_id}")
                elif output.get('session_id'):
                    real_session_id = output['session_id']
                    print(f"[CHAT] Captured real session ID: {real_session_id}")

            # Add real session_id to output if we have it
            if real_session_id and 'session_id' not in output:
                output['session_id'] = real_session_id

            await websocket.send_json(output)

            if output_type == "permission_request":
                print(f"[CHAT] Waiting for permission response...")
                try:
                    user_response = await asyncio.wait_for(
                        websocket.receive_json(),
                        timeout=300
                    )
                    response_type = user_response.get("type")
                    print(f"[CHAT] Received: {response_type}")

                    if response_type == "permission_response":
                        response_value = user_response.get("response", "")
                        print(f"[CHAT] Permission response: {response_value}")
                        await runner.send_input(response_value)
                    elif response_type == "stop":
                        await runner.stop()
                        break

                except asyncio.TimeoutError:
                    print("[CHAT] Permission response timeout")
                    await websocket.send_json({"type": "error", "message": "Permission response timeout"})
                    await runner.stop()
                    break
            else:
                try:
                    stop_check = await asyncio.wait_for(
                        websocket.receive_json(),
                        timeout=0.01
                    )
                    if stop_check.get("type") == "stop":
                        await runner.stop()
                        break
                    elif stop_check.get("type") == "permission_response":
                        await runner.send_input(stop_check.get("response", ""))
                except asyncio.TimeoutError:
                    pass

        print(f"[CHAT] Done streaming, total outputs: {output_count}, session_id: {real_session_id}")
        await websocket.send_json({"type": "chat_done", "session_id": real_session_id})

    except WebSocketDisconnect:
        if runner:
            await runner.stop()
    except Exception as e:
        print(f"[CHAT] Error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except:
            pass
        if runner:
            await runner.stop()
    finally:
        if chat_id in chat_connections:
            del chat_connections[chat_id]
