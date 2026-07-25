"""Lightweight Redis-backed rate limiter (fail-open).

Used to throttle sensitive endpoints such as login. If Redis is unavailable the limiter
fails open (allows the request) so authentication never hard-breaks on an infra hiccup.
Uses a simple fixed-window counter, which is sufficient for brute-force mitigation and
works across multiple uvicorn workers because the counter lives in Redis.
"""
import logging
from typing import Optional

import redis

from app.core.config import settings

logger = logging.getLogger(__name__)

_client: Optional["redis.Redis"] = None


def _get_client():
    """Return a cached Redis client, or None if Redis is unreachable (retried later)."""
    global _client
    if _client is not None:
        return _client
    try:
        client = redis.Redis.from_url(
            settings.REDIS_URL, socket_connect_timeout=1, socket_timeout=1
        )
        client.ping()
        _client = client
        return _client
    except Exception as exc:  # noqa: BLE001 - fail open on any connection error
        logger.warning("Rate limiter Redis unavailable, failing open: %s", exc)
        return None


def is_rate_limited(key: str, max_hits: int, window_seconds: int) -> bool:
    """Increment the counter for ``key`` and return True if the limit is exceeded."""
    client = _get_client()
    if client is None:
        return False  # fail open
    try:
        redis_key = f"ratelimit:{key}"
        hits = client.incr(redis_key)
        if hits == 1:
            client.expire(redis_key, window_seconds)
        return hits > max_hits
    except Exception as exc:  # noqa: BLE001 - never block auth on limiter failure
        logger.warning("Rate limiter error, failing open: %s", exc)
        return False
