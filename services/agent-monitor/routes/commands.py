"""Command endpoints."""

import json
import time

from fastapi import APIRouter

from config import COMMANDS_PATH
from models import Command, CommandFile
from services.websocket import manager

router = APIRouter()


@router.post("/api/command")
async def send_command(command: Command):
    """Send a command to an agent."""
    timestamp = int(time.time())
    cmd_id = f"{timestamp}-cmd"

    cmd_file = CommandFile(
        id=cmd_id,
        agent=command.agent,
        content=command.content,
        type=command.type,
        timestamp=timestamp,
        status="pending"
    )

    cmd_path = COMMANDS_PATH / f"{cmd_id}.json"
    cmd_path.write_text(cmd_file.model_dump_json(indent=2))

    await manager.broadcast({
        "type": "command_ack",
        "data": cmd_file.model_dump()
    })

    return {"success": True, "command": cmd_file}


@router.get("/api/commands")
async def get_commands(status: str = "pending"):
    """Get pending commands."""
    commands = []
    for cmd_file in sorted(COMMANDS_PATH.glob("*-cmd.json"), reverse=True)[:50]:
        try:
            data = json.loads(cmd_file.read_text())
            if status == "all" or data.get("status") == status:
                commands.append(data)
        except Exception:
            pass
    return {"commands": commands}
