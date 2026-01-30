from __future__ import annotations

import re
from typing import Any

from flask import request
from flask_socketio import SocketIO, emit, join_room, leave_room

from ..game import service


_room_tasks: dict[str, bool] = {}


def _normalize_text(text: str) -> str:
    t = text.strip().lower()
    t = re.sub(r"\s+", "", t)
    t = re.sub(r"[^0-9a-z\u4e00-\u9fff]", "", t)
    return t


def _contains_answer(text: str, answer: str) -> bool:
    a = _normalize_text(answer)
    if not a:
        return False
    return a in _normalize_text(text)


def _validate_name(name: str) -> bool:
    n = (name or "").strip()
    if not n:
        return False
    if len(n) > 16:
        return False
    # Avoid obvious HTML/script injection.
    if "<" in n or ">" in n:
        return False
    # No control characters.
    for ch in n:
        if ord(ch) < 32:
            return False
    return True


def _normalize_avatar(raw: str) -> str:
    a = (raw or "").strip()
    if re.fullmatch(r"\d{5,12}", a):
        return f"https://q1.qlogo.cn/g?b=qq&nk={a}&s=640"
    return ""


def register_socketio_handlers(socketio: SocketIO) -> None:
    def _broadcast_room_state(room_code: str) -> None:
        room = service.get_room(room_code)
        if not room:
            # Not an ack-driven handler; best-effort broadcast.
            try:
                socketio.emit("room:error", {"error": "room_not_found"}, to=room_code)
            except Exception:
                pass
            return

        public_state = service.room_public_state(room)
        socketio.emit("room:state", public_state, to=room_code)

        if room.drawer_id:
            private_state = service.room_public_state(room, viewer_socket_id=room.drawer_id)
            socketio.emit("room:state", private_state, to=room.drawer_id)

    def _safe_broadcast_room_state(room_code: str) -> None:
        try:
            _broadcast_room_state(room_code)
        except Exception:
            return

    def _append_chat(room, msg: dict) -> None:
        try:
            room.chat_history.append(msg)
            if len(room.chat_history) > 200:
                room.chat_history = room.chat_history[-200:]
        except Exception:
            return

    def _append_draw(room, item: dict) -> None:
        try:
            room.draw_history.append(item)
            if len(room.draw_history) > 2000:
                room.draw_history = room.draw_history[-2000:]
        except Exception:
            return

    def _handle_correct_guess(room_code: str, room, guesser_socket_id: str) -> None:
        # Prevent duplicate scoring per round
        if guesser_socket_id in room.correct_guessers:
            emit(
                "chat:message",
                {"roomCode": room_code, "from": "system", "text": "你已经猜中过了"},
                to=guesser_socket_id,
            )
            return

        room.correct_guessers.add(guesser_socket_id)

        # score
        if guesser_socket_id in room.players:
            room.players[guesser_socket_id].score += 10
        if room.drawer_id and room.drawer_id in room.players:
            room.players[room.drawer_id].score += 5

        emit("guess:correct", {"roomCode": room_code, "by": guesser_socket_id}, to=room_code)
        # If all non-drawer players have guessed, end the round immediately.
        try:
            if room.state == "playing" and room.drawer_id:
                non_drawers = [pid for pid in room.players.keys() if pid != room.drawer_id]
                if non_drawers and all(pid in room.correct_guessers for pid in non_drawers):
                    service.reveal_round(room)
                    socketio.emit("game:reveal", {"roomCode": room_code, "word": room.word}, to=room_code)
        except Exception:
            pass

        _safe_broadcast_room_state(room_code)
        return

    def _ensure_room_task(room_code: str) -> None:
        if _room_tasks.get(room_code):
            return
        _room_tasks[room_code] = True

        def _runner() -> None:
            last_sent: dict[str, int] = {}
            while True:
                room = service.get_room(room_code)
                if not room:
                    break

                now = service.now_ms()

                # Auto-destroy empty room after TTL (10s)
                try:
                    if not room.players:
                        if room.last_empty_at_ms is None:
                            room.last_empty_at_ms = now
                        elif now - room.last_empty_at_ms >= 10_000:
                            service.delete_room(room_code)
                            break
                except Exception:
                    pass

                # Choosing timeout -> auto choose first
                if room.state == "choosing" and room.choose_ends_at_ms and now >= room.choose_ends_at_ms:
                    service.auto_choose_if_needed(room)
                    _safe_broadcast_room_state(room_code)

                # Playing timeout -> reveal
                if room.state == "playing" and room.round_ends_at_ms and now >= room.round_ends_at_ms:
                    service.reveal_round(room)
                    socketio.emit("game:reveal", {"roomCode": room_code, "word": room.word}, to=room_code)
                    _safe_broadcast_room_state(room_code)

                # Reveal timeout -> back to lobby
                if room.state == "reveal" and room.reveal_ends_at_ms and now >= room.reveal_ends_at_ms:
                    service.advance_after_reveal(room)
                    _safe_broadcast_room_state(room_code)

                # Tick (once per second)
                sec = int(now / 1000)
                prev = last_sent.get(room_code)
                if prev != sec:
                    last_sent[room_code] = sec
                    socketio.emit("game:tick", {"roomCode": room_code, "nowMs": now}, to=room_code)

                socketio.sleep(0.25)

            _room_tasks.pop(room_code, None)

        socketio.start_background_task(_runner)

    @socketio.on("room:join")
    def room_join(data):
        payload = data or {}
        room_code = str(payload.get("roomCode", "")).strip()
        name = str(payload.get("name", "")).strip()
        avatar = str(payload.get("avatar", "")).strip()
        player_key = str(payload.get("playerKey", "")).strip()

        if not room_code or not _validate_name(name):
            emit("room:error", {"error": "invalid_payload"})
            return

        avatar = _normalize_avatar(avatar)

        room = service.get_room(room_code)
        if not room:
            emit("room:error", {"error": "room_not_found"})
            return

        # If the room only has a single ghost owner (e.g. old clients without playerKey),
        # allow the joining user to reclaim ownership.
        if player_key and room.owner_id in room.players and len(room.players) == 1:
            try:
                owner_p = room.players.get(room.owner_id)
                if owner_p and not getattr(owner_p, "player_key", "") and room.owner_id != request.sid:
                    try:
                        del room.players[room.owner_id]
                    except Exception:
                        pass
                    room.owner_id = request.sid
            except Exception:
                pass

        if room.owner_id == "rest" or not room.players:
            room.owner_id = request.sid

        join_room(room_code)
        
        # Store old owner_id before upsert (for playerKey migration)
        old_owner_id = room.owner_id
        
        service.upsert_player(room, request.sid, name=name, avatar=avatar, player_key=player_key)

        # Ensure owner_id always points to a connected player (fix solo-owner leave/rejoin).
        # Priority: 1) keep old owner if migrated via playerKey, 2) assign to current if rest/invalid
        if room.owner_id == "rest" or room.owner_id not in room.players:
            room.owner_id = request.sid
        elif old_owner_id != "rest" and old_owner_id not in room.players and player_key:
            # Old owner disconnected but this is a reconnect via playerKey - reclaim ownership
            old_pk = room.player_key_index.get(player_key)
            if old_pk == request.sid:
                room.owner_id = request.sid

        # Sync history to the joining client for reconnects / late joiners.
        draw_hist = getattr(room, "draw_history", [])
        # For Excalidraw: draw_history is now a list of elements, not stroke objects
        emit("draw:sync", {"roomCode": room_code, "elements": draw_hist if isinstance(draw_hist, list) else []}, to=request.sid)
        emit("chat:sync", {"roomCode": room_code, "messages": getattr(room, "chat_history", [])}, to=request.sid)

        _ensure_room_task(room_code)
        _safe_broadcast_room_state(room_code)

    @socketio.on("profile:update")
    def profile_update(data):
        payload = data or {}
        room_code = str(payload.get("roomCode", "")).strip()
        name = str(payload.get("name", "")).strip()
        avatar = str(payload.get("avatar", "")).strip()
        player_key = str(payload.get("playerKey", "")).strip()

        if not room_code:
            emit("room:error", {"error": "invalid_room"})
            return {"ok": False, "error": "invalid_room"}

        if not _validate_name(name):
            emit("room:error", {"error": "invalid_payload"})
            return {"ok": False, "error": "invalid_payload"}

        avatar = _normalize_avatar(avatar)

        room = service.get_room(room_code)
        if not room:
            emit("room:error", {"error": "room_not_found"})
            return {"ok": False, "error": "room_not_found"}

        if request.sid not in room.players:
            emit("room:error", {"error": "not_in_room"})
            return {"ok": False, "error": "not_in_room"}

        service.upsert_player(room, request.sid, name=name, avatar=avatar, player_key=player_key)
        _safe_broadcast_room_state(room_code)
        return {"ok": True}

    @socketio.on("room:leave")
    def room_leave(data):
        payload = data or {}
        room_code = str(payload.get("roomCode", "")).strip()
        if not room_code:
            return

        room = service.get_room(room_code)
        if not room:
            return

        leave_room(room_code)
        service.remove_player(room, request.sid)
        _safe_broadcast_room_state(room_code)

    @socketio.on("room:set_round_duration")
    def room_set_round_duration(data):
        payload = data or {}
        room_code = str(payload.get("roomCode", "")).strip()
        duration_raw: Any = payload.get("roundDurationSec")
        if not room_code:
            emit("room:error", {"error": "invalid_room"})
            return {"ok": False, "error": "invalid_room"}

        room = service.get_room(room_code)
        if not room:
            emit("room:error", {"error": "room_not_found"})
            return {"ok": False, "error": "room_not_found"}

        if request.sid != room.owner_id:
            emit("room:error", {"error": "only_owner"})
            return {"ok": False, "error": "only_owner"}

        try:
            duration_sec = int(duration_raw)
        except Exception:
            emit("room:error", {"error": "invalid_duration"})
            return {"ok": False, "error": "invalid_duration"}

        ok = service.set_round_duration(room, duration_sec)
        if not ok:
            emit("room:error", {"error": "invalid_duration"})
            return {"ok": False, "error": "invalid_duration"}

        _safe_broadcast_room_state(room_code)
        return {"ok": True}

    @socketio.on("room:set_rounds_per_match")
    def room_set_rounds_per_match(data):
        print(f"[DEBUG] room:set_rounds_per_match received from {request.sid}")
        payload = data or {}
        room_code = str(payload.get("roomCode", "")).strip()
        rounds_raw: Any = payload.get("roundsPerMatch")
        print(f"[DEBUG] room_code={room_code}, rounds_raw={rounds_raw}")
        if not room_code:
            emit("room:error", {"error": "invalid_room"})
            return {"ok": False, "error": "invalid_room"}

        room = service.get_room(room_code)
        if not room:
            emit("room:error", {"error": "room_not_found"})
            return {"ok": False, "error": "room_not_found"}

        if request.sid != room.owner_id:
            emit("room:error", {"error": "only_owner"})
            return {"ok": False, "error": "only_owner"}

        try:
            rpm = int(rounds_raw)
        except Exception:
            emit("room:error", {"error": "invalid_rounds"})
            return {"ok": False, "error": "invalid_rounds"}

        ok = service.set_rounds_per_match(room, rpm)
        if not ok:
            emit("room:error", {"error": "invalid_rounds"})
            return {"ok": False, "error": "invalid_rounds"}

        _safe_broadcast_room_state(room_code)
        return {"ok": True}

    @socketio.on("room:transfer_owner")
    def room_transfer_owner(data):
        payload = data or {}
        room_code = str(payload.get("roomCode", "")).strip()
        new_owner_id = str(payload.get("newOwnerId", "")).strip()
        if not room_code or not new_owner_id:
            emit("room:error", {"error": "invalid_payload"})
            return {"ok": False, "error": "invalid_payload"}

        room = service.get_room(room_code)
        if not room:
            emit("room:error", {"error": "room_not_found"})
            return {"ok": False, "error": "room_not_found"}

        if request.sid != room.owner_id:
            emit("room:error", {"error": "only_owner"})
            return {"ok": False, "error": "only_owner"}

        ok = service.transfer_owner(room, new_owner_id)
        if not ok:
            emit("room:error", {"error": "invalid_target"})
            return {"ok": False, "error": "invalid_target"}

        _safe_broadcast_room_state(room_code)
        return {"ok": True}

    @socketio.on("draw:excalidraw_change")
    def draw_excalidraw_change(data):
        payload = data or {}
        room_code = str(payload.get("roomCode", "")).strip()
        if not room_code:
            return

        room = service.get_room(room_code)
        if not room:
            return
        if room.state != "playing" or request.sid != room.drawer_id:
            return

        elements = payload.get("elements")
        if not isinstance(elements, list):
            return

        # Merge changed elements into draw_history
        try:
            if not hasattr(room, "draw_history") or not isinstance(room.draw_history, list):
                room.draw_history = []
            
            for el in elements:
                if not isinstance(el, dict) or "id" not in el:
                    continue
                # Update or append element
                idx = next((i for i, e in enumerate(room.draw_history) if isinstance(e, dict) and e.get("id") == el["id"]), None)
                if idx is not None:
                    room.draw_history[idx] = el
                else:
                    room.draw_history.append(el)
            
            # Keep history size reasonable
            if len(room.draw_history) > 2000:
                room.draw_history = room.draw_history[-2000:]
        except Exception:
            pass

        emit("draw:excalidraw_change", {"roomCode": room_code, "elements": elements}, to=room_code, include_self=False)

    @socketio.on("draw:clear")
    def draw_clear(data):
        payload = data or {}
        room_code = str(payload.get("roomCode", "")).strip()
        if not room_code:
            return

        room = service.get_room(room_code)
        if not room:
            return
        if room.state != "playing" or request.sid != room.drawer_id:
            return

        try:
            room.draw_history = []
        except Exception:
            pass

        emit("draw:clear", payload, to=room_code)

    @socketio.on("chat:message")
    def chat_message(data):
        payload = data or {}
        room_code = str(payload.get("roomCode", "")).strip()
        text = str(payload.get("text", ""))
        if not room_code or not text.strip():
            return

        room = service.get_room(room_code)
        if room and room.word and room.state in ("choosing", "playing") and _contains_answer(text, room.word):
            if request.sid == room.drawer_id:
                msg = {"roomCode": room_code, "from": "system", "text": "画手不能在聊天中泄露答案"}
                emit("chat:message", msg, to=request.sid)
                return

            if room.state == "playing":
                _handle_correct_guess(room_code, room, request.sid)
                return

        emit(
            "chat:message",
            {"roomCode": room_code, "from": request.sid, "text": text},
            to=room_code,
        )

        if room:
            _append_chat(room, {"roomCode": room_code, "from": request.sid, "text": text})

    @socketio.on("guess:submit")
    def guess_submit(data):
        payload = data or {}
        room_code = str(payload.get("roomCode", "")).strip()
        text = str(payload.get("text", ""))
        if not room_code or not text.strip():
            return

        room = service.get_room(room_code)
        if not room:
            return

        # Prevent drawer from leaking the answer via chat/guess box.
        if room.word and request.sid == room.drawer_id and room.state in ("choosing", "playing"):
            if _contains_answer(text, room.word):
                emit(
                    "chat:message",
                    {"roomCode": room_code, "from": "system", "text": "画手不能直接发送答案"},
                    to=request.sid,
                )
                return

        if room.state == "playing" and room.word and request.sid != room.drawer_id and _contains_answer(text, room.word):
            _handle_correct_guess(room_code, room, request.sid)
        else:
            emit("chat:message", {"roomCode": room_code, "from": request.sid, "text": text}, to=room_code)

            _append_chat(room, {"roomCode": room_code, "from": request.sid, "text": text})

    @socketio.on("game:abort")
    def game_abort(data):
        payload = data or {}
        room_code = str(payload.get("roomCode", "")).strip()
        if not room_code:
            return

        room = service.get_room(room_code)
        if not room:
            return

        if request.sid != room.owner_id:
            emit("game:error", {"error": "only_owner"})
            return

        if room.state not in ("choosing", "playing"):
            return

        service.abort_round(room)
        socketio.emit("game:reveal", {"roomCode": room_code, "word": room.word}, to=room_code)
        _safe_broadcast_room_state(room_code)

    @socketio.on("game:abort_vote")
    def game_abort_vote(data):
        payload = data or {}
        room_code = str(payload.get("roomCode", "")).strip()
        if not room_code:
            return

        room = service.get_room(room_code)
        if not room:
            return

        votes, needed, aborted = service.add_abort_vote(room, voter_socket_id=request.sid)
        if aborted:
            socketio.emit("game:reveal", {"roomCode": room_code, "word": room.word}, to=room_code)
        _safe_broadcast_room_state(room_code)

    @socketio.on("game:abort_match")
    def game_abort_match(data):
        print(f"[DEBUG] game:abort_match received from {request.sid}")
        payload = data or {}
        room_code = str(payload.get("roomCode", "")).strip()
        print(f"[DEBUG] room_code={room_code}")
        if not room_code:
            emit("game:error", {"error": "invalid_room"})
            return {"ok": False, "error": "invalid_room"}

        room = service.get_room(room_code)
        if not room:
            emit("game:error", {"error": "room_not_found"})
            return {"ok": False, "error": "room_not_found"}

        if request.sid != room.owner_id:
            emit("game:error", {"error": "only_owner"})
            return {"ok": False, "error": "only_owner"}

        service.abort_match(room)
        _safe_broadcast_room_state(room_code)
        return {"ok": True}

    @socketio.on("game:abort_match_vote")
    def game_abort_match_vote(data):
        print(f"[DEBUG] game:abort_match_vote received from {request.sid}")
        payload = data or {}
        room_code = str(payload.get("roomCode", "")).strip()
        print(f"[DEBUG] room_code={room_code}")
        if not room_code:
            emit("game:error", {"error": "invalid_room"})
            return {"ok": False, "error": "invalid_room"}

        room = service.get_room(room_code)
        if not room:
            emit("game:error", {"error": "room_not_found"})
            return {"ok": False, "error": "room_not_found"}

        votes, needed, aborted = service.add_match_abort_vote(room, voter_socket_id=request.sid)
        _safe_broadcast_room_state(room_code)
        return {"ok": True, "votes": votes, "needed": needed, "aborted": aborted}

    @socketio.on("game:start")
    def game_start(data):
        payload = data or {}
        room_code = str(payload.get("roomCode", "")).strip()
        if not room_code:
            return

        room = service.get_room(room_code)
        if not room:
            return

        if request.sid != room.owner_id:
            emit("game:error", {"error": "only_owner"})
            return

        custom_words_raw: Any = payload.get("customWords")
        custom_words: list[str] = []
        if isinstance(custom_words_raw, list):
            for w in custom_words_raw:
                if isinstance(w, str) and w.strip():
                    custom_words.append(w.strip())

        # New round begins: clear board for everyone and reset server-side history.
        try:
            room.draw_history = []
        except Exception:
            pass
        socketio.emit("draw:clear", {"roomCode": room_code}, to=room_code)

        service.start_match(room, custom_words=custom_words)
        _safe_broadcast_room_state(room_code)
        _ensure_room_task(room_code)

    @socketio.on("game:choose_word")
    def game_choose_word(data):
        payload = data or {}
        room_code = str(payload.get("roomCode", "")).strip()
        word = str(payload.get("word", "")).strip()
        if not room_code or not word:
            return

        room = service.get_room(room_code)
        if not room:
            return

        ok = service.choose_word(room, chooser_socket_id=request.sid, word=word)
        if not ok:
            emit("game:error", {"error": "choose_not_allowed"})
            return

        _broadcast_room_state(room_code)
        _ensure_room_task(room_code)

    @socketio.on("disconnect")
    def on_disconnect():
        # Remove player from any rooms where present (MVP linear scan)
        for r in service.list_rooms():
            if request.sid in r.players:
                service.remove_player(r, request.sid)
                # If the disconnected player was the owner, reassign to first remaining player
                if r.owner_id == request.sid and r.players:
                    r.owner_id = next(iter(r.players.keys()))
                _safe_broadcast_room_state(r.code)
