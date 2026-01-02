from __future__ import annotations

import os
import sys
from pathlib import Path

from flask import Flask, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO
from werkzeug.middleware.proxy_fix import ProxyFix

from .config import Config
from .routes.health import bp as health_bp
from .routes.rooms import bp as rooms_bp
from .routes.words import bp as words_bp
from .routes.evil import bp as evil_bp
from .realtime.handlers import register_socketio_handlers


def create_app() -> tuple[Flask, SocketIO]:
    dist_dir = Path(__file__).resolve().parents[2] / "frontend" / "dist"

    static_folder = str(dist_dir) if dist_dir.exists() else None
    static_url_path = "/" if dist_dir.exists() else None

    app = Flask(
        __name__,
        static_folder=static_folder,
        static_url_path=static_url_path,
    )
    app.config.from_object(Config)

    if app.config.get("TRUST_PROXY_HEADERS", False):
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)

    cors_origins = app.config.get("CORS_ORIGINS", "*")
    CORS(app, resources={r"/api/*": {"origins": cors_origins}})

    env_async_mode = os.environ.get("SOCKETIO_ASYNC_MODE", "").strip()
    if env_async_mode:
        async_mode = env_async_mode
    else:
        # Default choice:
        # - Windows: threading (eventlet has known compatibility issues on newer Python)
        # - Python >= 3.13: threading (safer default)
        # - Otherwise: eventlet
        if sys.platform.startswith("win") or sys.version_info >= (3, 13):
            async_mode = "threading"
        else:
            async_mode = "eventlet"

    socketio = SocketIO(
        app,
        cors_allowed_origins=cors_origins,
        async_mode=async_mode,
    )

    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(rooms_bp, url_prefix="/api")
    app.register_blueprint(words_bp, url_prefix="/api")
    app.register_blueprint(evil_bp, url_prefix="/api")

    register_socketio_handlers(socketio)

    if dist_dir.exists():
        @app.get("/")
        def index():
            return send_from_directory(dist_dir, "index.html")

        @app.get("/<path:path>")
        def static_proxy(path: str):
            file_path = dist_dir / path
            if file_path.exists() and file_path.is_file():
                return send_from_directory(dist_dir, path)
            return send_from_directory(dist_dir, "index.html")

    return app, socketio
