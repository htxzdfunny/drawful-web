try:
    from backend.drawful.server import create_app
except ImportError:  # pragma: no cover
    from drawful.server import create_app

app, socketio = create_app()
