from __future__ import annotations

from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.models import Lead


def compute_temperature(score: int) -> str:
    if score >= 70:
        return "hot"
    if score >= 40:
        return "warm"
    return "cold"


def score_delta_from_call_status(status: str) -> int:
    mapping = {
        "answered": 15,
        "completed": 20,
        "in_progress": 10,
        "ringing": 2,
        "no_response": -12,
        "no_answer": -12,
        "busy": -6,
        "failed": -10,
        "hangup": -8,
    }
    return mapping.get((status or "").lower(), 0)


def score_delta_from_message_response(content: str) -> int:
    text = (content or "").lower()
    if any(token in text for token in ["book", "demo", "interested", "yes", "proceed"]):
        return 10
    if any(token in text for token in ["not interested", "stop", "no thanks", "later"]):
        return -10
    return 0


async def update_lead_score(
    db: AsyncSession,
    *,
    lead_id: Optional[str],
    score_delta: int,
) -> None:
    if not lead_id or score_delta == 0:
        return

    lead = (await db.execute(select(Lead).where(Lead.id == lead_id))).scalar_one_or_none()
    if not lead:
        return

    current = int(lead.lead_score or 0)
    updated = max(0, min(100, current + score_delta))
    lead.lead_score = updated
    lead.lead_temperature = compute_temperature(updated)
