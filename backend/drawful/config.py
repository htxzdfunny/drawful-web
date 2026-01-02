import os


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev")

    # CORS
    CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*")

    # Evil admin
    EVIL_TOKEN = os.environ.get("EVIL_TOKEN", "")

    # Reverse proxy / IP headers
    TRUST_PROXY_HEADERS = os.environ.get("TRUST_PROXY_HEADERS", "1") == "1"

    # Storage (MVP defaults to in-memory)
    REDIS_URL = os.environ.get("REDIS_URL", "")
    MYSQL_DSN = os.environ.get("MYSQL_DSN", "")

    # Game
    ROUND_DURATION_SEC = int(os.environ.get("ROUND_DURATION_SEC", "60"))
    WORD_CHOICES_COUNT = int(os.environ.get("WORD_CHOICES_COUNT", "3"))
    CHOOSE_DURATION_SEC = int(os.environ.get("CHOOSE_DURATION_SEC", "12"))
    REVEAL_DURATION_SEC = int(os.environ.get("REVEAL_DURATION_SEC", "6"))
