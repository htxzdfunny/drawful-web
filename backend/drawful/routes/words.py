from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..game import service

bp = Blueprint("words", __name__)


@bp.get("/words")
def get_words():
    try:
        count = int(request.args.get("count", "3"))
    except ValueError:
        count = 3

    # Custom words (simple MVP): comma separated, or multiple words[] query params
    custom_words: list[str] = []
    if request.args.get("custom"):
        custom_words.extend([w.strip() for w in request.args.get("custom", "").split(",") if w.strip()])
    custom_words.extend([w.strip() for w in request.args.getlist("words[]") if w.strip()])

    choices = service.get_word_choices(count=count, custom_words=custom_words)
    return jsonify({"words": choices})
