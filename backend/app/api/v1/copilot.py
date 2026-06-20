"""
PRAVESHA AI Copilot — conversational assistant powered by OpenAI.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.logger import logger
from app.core.security import get_current_user
from app.models.models import Call, Lead, LeadFollowUp, User
from app.services.ai_content import _chat_completion

router = APIRouter()


class CopilotChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: Optional[list[dict]] = None


class CopilotChatResponse(BaseModel):
    reply: str
    model: str


def _history_content(item: dict) -> str:
    return str(item.get("content") or item.get("text") or "").strip()


async def _crm_snapshot(db: AsyncSession) -> str:
    total_leads = (await db.execute(select(func.count(Lead.id)))).scalar_one() or 0
    total_calls = (await db.execute(select(func.count(Call.id)))).scalar_one() or 0
    pending_followups = (
        await db.execute(
            select(func.count(LeadFollowUp.id)).where(LeadFollowUp.is_completed.is_(False))
        )
    ).scalar_one() or 0
    converted_leads = (
        await db.execute(select(func.count(Lead.id)).where(Lead.status == "converted"))
    ).scalar_one() or 0
    answered_calls = (
        await db.execute(
            select(func.count(Call.id)).where(Call.status.in_(["answered", "completed"]))
        )
    ).scalar_one() or 0

    return (
        f"Leads: {total_leads} total, {converted_leads} converted. "
        f"Calls: {total_calls} total, {answered_calls} answered/completed. "
        f"Pending follow-ups: {pending_followups}."
    )


@router.post("/chat", response_model=CopilotChatResponse)
async def copilot_chat(
    payload: CopilotChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if settings.MOCK_SERVICES and not settings.OPENAI_API_KEY and not settings.GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="AI service is not configured")

    snapshot = await _crm_snapshot(db)
    company = getattr(settings, "COMPANY_NAME", None) or "your CRM"

    system_prompt = (
        f"You are PRAVESHA AI Copilot, a helpful CRM assistant for {company}. "
        "Answer questions about leads, calls, follow-ups, scheduling, and sales insights. "
        "Be concise, actionable, and professional. Use the live CRM snapshot when relevant. "
        "If you do not have specific data, say what the user can check in the CRM and suggest next steps.\n\n"
        f"Live CRM snapshot: {snapshot}\n"
        f"Current user: {current_user.full_name or current_user.email}"
    )

    messages: list[dict] = [{"role": "system", "content": system_prompt}]

    for item in payload.history or []:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = _history_content(item)
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": payload.message.strip()})

    try:
        reply = await _chat_completion(
            messages,
            temperature=0.6,
            max_tokens=600,
        )
    except Exception as exc:
        logger.warning(f"Copilot chat failed: {exc}")
        raise HTTPException(status_code=503, detail="AI assistant is temporarily unavailable") from exc

    if not reply:
        raise HTTPException(status_code=502, detail="Empty response from AI assistant")

    return CopilotChatResponse(reply=reply, model=settings.OPENAI_MODEL)
