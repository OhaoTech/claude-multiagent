"""WebSocket connection manager."""

import time
from fastapi import WebSocket


class ConnectionManager:
    """Manage WebSocket connections."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        """Send message to all connected clients."""
        message["timestamp"] = time.time()
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass  # Client disconnected


# Global manager instance
manager = ConnectionManager()
