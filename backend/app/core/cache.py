from __future__ import annotations

import json
from typing import Any, Optional

from app.core.config import settings
from app.core.redis_client import get_redis_client


async def cache_get_json(key: str) -> Optional[Any]:
    client = await get_redis_client()
    if not client:
        return None

    raw = await client.get(key)
    if not raw:
        return None

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


async def cache_set_json(key: str, payload: Any, ttl_seconds: Optional[int] = None) -> None:
    client = await get_redis_client()
    if not client:
        return

    ttl = int(ttl_seconds or settings.REDIS_TTL)
    await client.set(key, json.dumps(payload), ex=max(ttl, 1))


async def cache_delete(key: str) -> None:
    client = await get_redis_client()
    if not client:
        return
    await client.delete(key)
