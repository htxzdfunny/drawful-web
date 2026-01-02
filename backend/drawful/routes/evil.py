from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..config import Config
from ..game import service

bp = Blueprint("evil", __name__)


def _authorized() -> bool:
    token = Config.EVIL_TOKEN
    if not token:
        return False
    return request.headers.get("X-Evil-Token", "") == token


@bp.get("/__evil__/rooms")
def evil_rooms():
    if not _authorized():
        return jsonify({"error": "unauthorized"}), 401

    rooms = service.list_rooms()
    payload = [service.room_public_state(r) for r in rooms]
    return jsonify({"rooms": payload})


@bp.post("/__evil__/rooms/<code>/override")
def evil_override(code: str):
    if not _authorized():
        return jsonify({"error": "unauthorized"}), 401

    room = service.get_room(code)
    if not room:
        return jsonify({"error": "room_not_found"}), 404

    data = request.get_json(silent=True) or {}

    if "nextWord" in data and isinstance(data["nextWord"], str):
        room.next_word = data["nextWord"].strip() or None

    if "nextDrawerId" in data and isinstance(data["nextDrawerId"], str):
        room.next_drawer_id = data["nextDrawerId"].strip() or None

    if "scores" in data and isinstance(data["scores"], dict):
        for pid, score in data["scores"].items():
            if pid in room.players and isinstance(score, int):
                room.players[pid].score = score

    return jsonify({"ok": True, "room": service.room_public_state(room)})
