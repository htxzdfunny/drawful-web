from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


RoomState = Literal["lobby", "choosing", "playing", "reveal"]


@dataclass
class Player:
    id: str
    name: str
    avatar: str = ""
    score: int = 0
    connected: bool = True
    player_key: str = ""


@dataclass
class Room:
    code: str
    owner_id: str
    state: RoomState = "lobby"
    round: int = 0
    rounds_per_match: int = 3
    match_round_index: int = 0
    drawer_id: str | None = None
    word: str | None = None
    started_at_ms: int | None = None
    choose_ends_at_ms: int | None = None
    round_ends_at_ms: int | None = None
    reveal_ends_at_ms: int | None = None
    word_choices: list[str] = field(default_factory=list)
    custom_words: list[str] = field(default_factory=list)
    correct_guessers: set[str] = field(default_factory=set)
    abort_votes: set[str] = field(default_factory=set)
    match_abort_votes: set[str] = field(default_factory=set)
    round_duration_sec: int = 60
    players: dict[str, Player] = field(default_factory=dict)
    player_key_index: dict[str, str] = field(default_factory=dict)
    last_empty_at_ms: int | None = None
    draw_history: list[dict] = field(default_factory=list)
    chat_history: list[dict] = field(default_factory=list)
    # Admin overrides
    next_word: str | None = None
    next_drawer_id: str | None = None
