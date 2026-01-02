from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..game import service

bp = Blueprint("rooms", __name__)


@bp.post("/rooms")
def create_room():
    # In this simplified MVP, room is created without binding to an actual socket yet.
    room = service.create_room(owner_socket_id="rest")
    return jsonify({"roomCode": room.code})


@bp.get("/rooms/<code>")
def get_room(code: str):
    room = service.get_room(code)
    if not room:
        return jsonify({"error": "room_not_found"}), 404
    return jsonify(service.room_public_state(room))
