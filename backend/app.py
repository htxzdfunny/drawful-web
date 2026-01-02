import os

import sys

from pathlib import Path

from dotenv import load_dotenv


def main() -> None:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")

    env_async_mode = os.environ.get("SOCKETIO_ASYNC_MODE", "").strip()
    if (
        not sys.platform.startswith("win")
        and sys.version_info < (3, 13)
        and env_async_mode in ("", "eventlet")
    ):
        import eventlet

        eventlet.monkey_patch()

    try:
        from backend.drawful.server import create_app
    except ImportError:  # pragma: no cover
        from drawful.server import create_app

    app, socketio = create_app()

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"

    allow_unsafe_werkzeug = os.environ.get("ALLOW_UNSAFE_WERKZEUG", "1") == "1"
    use_reloader = os.environ.get("FLASK_USE_RELOADER", "0") == "1"

    socketio.run(
        app,
        host=host,
        port=port,
        debug=debug,
        allow_unsafe_werkzeug=allow_unsafe_werkzeug,
        use_reloader=use_reloader,
    )


if __name__ == "__main__":
    main()
