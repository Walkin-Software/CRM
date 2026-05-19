from __future__ import annotations

from typing import Optional
import redis.asyncio as redis

from app.core.config import settings
from app.core.logger import logger


_redis_client: Optional[redis.Redis] = None


async def get_redis_client() -> Optional[redis.Redis]:
    global _redis_client
    if _redis_client is not None:
        return _redis_client

    try:
        client = redis.from_url(settings.REDIS_URL, decode_responses=True)
        await client.ping()
        _redis_client = client
        return _redis_client
    except Exception as exc:
        logger.warning(f"Redis unavailable at startup, cache/queue features will degrade gracefully: {exc}")
        return None


async def close_redis_client() -> None:
    global _redis_client
    if _redis_client is not None:
        await _redis_client.aclose()
        _redis_client = None
