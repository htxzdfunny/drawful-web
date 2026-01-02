from __future__ import annotations

from flask_socketio import SocketIO, emit, join_room, leave_room

from ..game import service


def register_socketio_handlers(socketio: SocketIO) -> None:
    @socketio.on("room:join")
    def on_room_join(data):
        room_code = (data or {}).get("roomCode", "")
        name = (data or {}).get("name", "")
        avatar = (data or {}).get("avatar", "")

        if not room_code or not name:
            emit("error", {"error": "invalid_payload"})
            return

        room = service.get_room(room_code)
        if not room:
            room = service.create_room(owner_socket_id="rest")
            room.code = room_code  # allow joining pre-created code

        player = service.upsert_player(room, socketio.server.eio_sid_from_environ(None) if False else None, name, avatar)  # type: ignore[arg-type]

        # The above is a placeholder; we rely on request.sid inside SocketIO context.

    @socketio.on("disconnect")
    def on_disconnect():
        # cleanup handled by per-room leave events in MVP
        pass
