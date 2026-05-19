from __future__ import annotations

from typing import Sequence
import math

from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import ConversationEmbedding


async def _embed_text(text: str) -> list[float]:
    if not settings.OPENAI_API_KEY:
        return []

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    response = await client.embeddings.create(
        model=settings.OPENAI_EMBEDDING_MODEL,
        input=text[:4000],
    )
    return response.data[0].embedding


def _cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    if not a or not b or len(a) != len(b):
        return -1.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if not norm_a or not norm_b:
        return -1.0
    return dot / (norm_a * norm_b)


async def upsert_conversation_memory(
    db: AsyncSession,
    *,
    lead_id: str | None,
    conversation_id: str,
    message_id: str,
    content: str,
) -> None:
    if not settings.AI_MEMORY_ENABLED or not content.strip():
        return

    embedding = await _embed_text(content)
    if not embedding:
        return

    row = ConversationEmbedding(
        lead_id=lead_id,
        conversation_id=conversation_id,
        message_id=message_id,
        embedding_model=settings.OPENAI_EMBEDDING_MODEL,
        embedding=embedding,
        content_excerpt=content[:500],
    )
    db.add(row)


async def find_similar_memories(
    db: AsyncSession,
    *,
    lead_id: str,
    query: str,
    top_k: int = 3,
) -> list[str]:
    if not settings.AI_MEMORY_ENABLED or not query.strip():
        return []

    q_vec = await _embed_text(query)
    if not q_vec:
        return []

    rows = (
        await db.execute(
            select(ConversationEmbedding)
            .where(ConversationEmbedding.lead_id == lead_id)
            .order_by(ConversationEmbedding.created_at.desc())
            .limit(100)
        )
    ).scalars().all()

    ranked = sorted(
        rows,
        key=lambda row: _cosine_similarity(row.embedding or [], q_vec),
        reverse=True,
    )
    return [row.content_excerpt for row in ranked[: max(1, top_k)] if row.content_excerpt]
