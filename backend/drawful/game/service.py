from __future__ import annotations

import time
import uuid
from dataclasses import asdict
from threading import RLock

from ..config import Config
from .models import Player, Room
from .words import DEFAULT_WORDS_ZH, pick_words


def now_ms() -> int:
    return int(time.time() * 1000)


_lock = RLock()
_rooms: dict[str, Room] = {}


def create_room(owner_socket_id: str, round_duration_sec: int | None = None) -> Room:
    with _lock:
        code = uuid.uuid4().hex
        while code in _rooms:
            code = uuid.uuid4().hex

        room = Room(
            code=code,
            owner_id=owner_socket_id,
            round_duration_sec=round_duration_sec or Config.ROUND_DURATION_SEC,
        )
        _rooms[code] = room
        return room


def get_room(code: str) -> Room | None:
    with _lock:
        return _rooms.get(code)


def delete_room(code: str) -> bool:
    with _lock:
        if code in _rooms:
            del _rooms[code]
            return True
        return False


def list_rooms() -> list[Room]:
    with _lock:
        return list(_rooms.values())


def upsert_player(
    room: Room,
    socket_id: str,
    name: str,
    avatar: str = "",
    player_key: str = "",
) -> Player:
    with _lock:
        # Any join cancels pending empty-room TTL.
        room.last_empty_at_ms = None

        pk = (player_key or "").strip()

        # Dedup / reconnect by playerKey: migrate old socket_id -> new socket_id
        if pk:
            old_sid = room.player_key_index.get(pk)
            if old_sid and old_sid != socket_id:
                old_player = room.players.get(old_sid)
                if old_player is not None:
                    # Preserve score and migrate stateful references.
                    preserved_score = old_player.score
                    del room.players[old_sid]

                    if room.owner_id == old_sid:
                        room.owner_id = socket_id
                    if room.drawer_id == old_sid:
                        room.drawer_id = socket_id

                    if old_sid in room.correct_guessers:
                        room.correct_guessers.discard(old_sid)
                        room.correct_guessers.add(socket_id)
                    if old_sid in room.abort_votes:
                        room.abort_votes.discard(old_sid)
                        room.abort_votes.add(socket_id)

                    if hasattr(room, "match_abort_votes") and old_sid in room.match_abort_votes:
                        room.match_abort_votes.discard(old_sid)
                        room.match_abort_votes.add(socket_id)

                    player = room.players.get(socket_id)
                    if player is None:
                        player = Player(id=socket_id, player_key=pk, name=name, avatar=avatar, score=preserved_score, connected=True)
                        room.players[socket_id] = player
                    else:
                        player.name = name
                        player.avatar = avatar
                        player.score = preserved_score
                        player.connected = True
                        player.player_key = pk
                else:
                    # Stale mapping: just overwrite below.
                    pass

        player = room.players.get(socket_id)
        if player is None:
            player = Player(id=socket_id, player_key=pk, name=name, avatar=avatar, score=0, connected=True)
            room.players[socket_id] = player
        else:
            player.name = name
            player.avatar = avatar
            player.connected = True
            if pk:
                player.player_key = pk

        if pk:
            room.player_key_index[pk] = socket_id

        return player


def remove_player(room: Room, socket_id: str) -> None:
    with _lock:
        # Clear playerKey index if present.
        try:
            pk = room.players.get(socket_id).player_key if socket_id in room.players else ""
            if pk and room.player_key_index.get(pk) == socket_id:
                del room.player_key_index[pk]
        except Exception:
            pass

        if socket_id in room.players:
            del room.players[socket_id]

        try:
            if socket_id in room.match_abort_votes:
                room.match_abort_votes.discard(socket_id)
        except Exception:
            pass

        if not room.players:
            room.last_empty_at_ms = now_ms()

        if room.owner_id == socket_id:
            # Assign a new owner if possible
            for pid in room.players.keys():
                room.owner_id = pid
                break


def set_round_duration(room: Room, duration_sec: int) -> bool:
    with _lock:
        if not isinstance(duration_sec, int):
            return False
        if duration_sec < 10 or duration_sec > 300:
            return False

        room.round_duration_sec = duration_sec

        # If a round is already running, apply immediately.
        if room.state == "playing" and room.started_at_ms:
            room.round_ends_at_ms = room.started_at_ms + (room.round_duration_sec * 1000)

        return True


def transfer_owner(room: Room, new_owner_socket_id: str) -> bool:
    with _lock:
        if not new_owner_socket_id:
            return False
        if new_owner_socket_id not in room.players:
            return False
        room.owner_id = new_owner_socket_id
        return True


def room_public_state(room: Room, viewer_socket_id: str | None = None) -> dict:
    with _lock:
        # Do NOT expose player_key to other clients.
        players = []
        for p in room.players.values():
            d = asdict(p)
            d.pop("player_key", None)
            players.append(d)
        total_players = max(0, len(room.players))
        # Abort needs >3/5 of players to agree.
        abort_needed = int((3 * total_players) / 5) + 1 if total_players > 0 else 0
        word_hint = None
        if room.word:
            word_hint = "_" * len(room.word)

        payload = {
            "code": room.code,
            "ownerId": room.owner_id,
            "state": room.state,
            "round": room.round,
            "roundsPerMatch": getattr(room, "rounds_per_match", 3),
            "matchRoundIndex": getattr(room, "match_round_index", 0),
            "drawerId": room.drawer_id,
            "roundDurationSec": room.round_duration_sec,
            "startedAtMs": room.started_at_ms,
            "chooseEndsAtMs": room.choose_ends_at_ms,
            "roundEndsAtMs": room.round_ends_at_ms,
            "revealEndsAtMs": room.reveal_ends_at_ms,
            "players": players,
            "wordHint": word_hint,
            "abortVotesCount": len(room.abort_votes),
            "abortVotesNeeded": abort_needed,
            "matchAbortVotesCount": len(getattr(room, "match_abort_votes", set())),
            "matchAbortVotesNeeded": abort_needed,
        }

        if room.state == "reveal" and room.word:
            payload["word"] = room.word

        if viewer_socket_id and viewer_socket_id == room.drawer_id:
            if room.word:
                payload["word"] = room.word
            if room.state == "choosing" and room.word_choices:
                payload["wordChoices"] = list(room.word_choices)

        return payload


def get_word_choices(count: int | None = None, custom_words: list[str] | None = None) -> list[str]:
    words = (custom_words or []) + DEFAULT_WORDS_ZH
    return pick_words(words, count or Config.WORD_CHOICES_COUNT)


def start_choosing(room: Room, custom_words: list[str] | None = None) -> None:
    with _lock:
        room.state = "choosing"
        room.round += 1
        room.started_at_ms = None
        room.round_ends_at_ms = None
        room.reveal_ends_at_ms = None
        room.correct_guessers = set()
        room.abort_votes = set()
        room.match_abort_votes = set()

        room.custom_words = list(custom_words or [])
        room.word = None
        room.word_choices = get_word_choices(custom_words=room.custom_words)
        room.choose_ends_at_ms = now_ms() + (Config.CHOOSE_DURATION_SEC * 1000)

        # drawer rotation
        player_ids = list(room.players.keys())
        if not player_ids:
            room.drawer_id = None
            room.choose_ends_at_ms = None
            return

        if room.next_drawer_id and room.next_drawer_id in room.players:
            room.drawer_id = room.next_drawer_id
        else:
            if room.drawer_id in player_ids:
                idx = player_ids.index(room.drawer_id)
                room.drawer_id = player_ids[(idx + 1) % len(player_ids)]
            else:
                room.drawer_id = player_ids[0]

        # Admin override for next word: skip choosing and go directly playing
        if room.next_word:
            _start_playing_locked(room, word=room.next_word)


def _start_playing_locked(room: Room, word: str) -> None:
    room.state = "playing"
    room.word = word
    room.word_choices = []
    room.choose_ends_at_ms = None
    room.started_at_ms = now_ms()
    room.round_ends_at_ms = room.started_at_ms + (room.round_duration_sec * 1000)
    room.reveal_ends_at_ms = None
    room.correct_guessers = set()
    room.abort_votes = set()
    room.next_word = None
    room.next_drawer_id = None


def choose_word(room: Room, chooser_socket_id: str, word: str) -> bool:
    with _lock:
        if room.state != "choosing":
            return False
        if chooser_socket_id != room.drawer_id:
            return False

        w = (word or "").strip()
        if not w:
            return False
        if room.word_choices and w not in room.word_choices:
            return False

        _start_playing_locked(room, word=w)
        return True


def reveal_round(room: Room) -> None:
    with _lock:
        room.state = "reveal"
        room.choose_ends_at_ms = None
        room.round_ends_at_ms = None
        room.reveal_ends_at_ms = now_ms() + (Config.REVEAL_DURATION_SEC * 1000)
        room.abort_votes = set()
        room.match_abort_votes = set()


def reset_to_lobby(room: Room) -> None:
    with _lock:
        room.state = "lobby"
        room.word = None
        room.word_choices = []
        room.choose_ends_at_ms = None
        room.round_ends_at_ms = None
        room.reveal_ends_at_ms = None
        room.correct_guessers = set()
        room.abort_votes = set()
        room.match_abort_votes = set()
        room.match_round_index = 0


def set_rounds_per_match(room: Room, rounds_per_match: int) -> bool:
    with _lock:
        if not isinstance(rounds_per_match, int):
            return False
        if rounds_per_match < 1 or rounds_per_match > 20:
            return False
        if room.state != "lobby":
            return False
        room.rounds_per_match = rounds_per_match
        return True


def start_match(room: Room, custom_words: list[str] | None = None) -> None:
    with _lock:
        room.match_round_index = 1
    start_round(room, custom_words=custom_words)


def advance_after_reveal(room: Room) -> bool:
    with _lock:
        rpm = getattr(room, "rounds_per_match", 3)
        idx = getattr(room, "match_round_index", 0)
        if idx <= 0:
            reset_to_lobby(room)
            return False

        if idx < rpm:
            room.match_round_index = idx + 1
            start_choosing(room, custom_words=room.custom_words)
            return True

        reset_to_lobby(room)
        return False


def abort_round(room: Room) -> None:
    with _lock:
        if room.state not in ("choosing", "playing"):
            return
        # Go to reveal immediately.
        room.state = "reveal"
        room.choose_ends_at_ms = None
        room.round_ends_at_ms = None
        room.reveal_ends_at_ms = now_ms() + (Config.REVEAL_DURATION_SEC * 1000)
        room.abort_votes = set()
        room.match_abort_votes = set()


def abort_match(room: Room) -> None:
    with _lock:
        reset_to_lobby(room)


def add_abort_vote(room: Room, voter_socket_id: str) -> tuple[int, int, bool]:
    """Returns (votes_count, votes_needed, aborted)."""
    with _lock:
        if room.state not in ("choosing", "playing"):
            return 0, 0, False

        if voter_socket_id not in room.players:
            return len(room.abort_votes), 0, False

        room.abort_votes.add(voter_socket_id)

        total_players = max(0, len(room.players))
        needed = int((3 * total_players) / 5) + 1 if total_players > 0 else 0
        votes = len(room.abort_votes)

        if needed > 0 and votes >= needed:
            # Abort the round
            room.state = "reveal"
            room.choose_ends_at_ms = None
            room.round_ends_at_ms = None
            room.reveal_ends_at_ms = now_ms() + (Config.REVEAL_DURATION_SEC * 1000)
            room.abort_votes = set()
            room.match_abort_votes = set()
            return votes, needed, True

        return votes, needed, False


def add_match_abort_vote(room: Room, voter_socket_id: str) -> tuple[int, int, bool]:
    """Returns (votes_count, votes_needed, aborted)."""
    with _lock:
        if room.state not in ("choosing", "playing", "reveal"):
            return 0, 0, False

        if voter_socket_id not in room.players:
            return len(room.match_abort_votes), 0, False

        room.match_abort_votes.add(voter_socket_id)

        total_players = max(0, len(room.players))
        needed = int((3 * total_players) / 5) + 1 if total_players > 0 else 0
        votes = len(room.match_abort_votes)

        if needed > 0 and votes >= needed:
            reset_to_lobby(room)
            return votes, needed, True

        return votes, needed, False


def auto_choose_if_needed(room: Room) -> None:
    with _lock:
        if room.state != "choosing":
            return

        if room.word_choices:
            _start_playing_locked(room, word=room.word_choices[0])
            return

        # Fallback (should not happen because DEFAULT_WORDS_ZH is non-empty)
        _start_playing_locked(room, word=pick_words(DEFAULT_WORDS_ZH, 1)[0])


def start_round(room: Room, custom_words: list[str] | None = None) -> None:
    start_choosing(room, custom_words=custom_words)
