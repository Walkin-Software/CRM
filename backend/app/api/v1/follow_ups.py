"""
Follow-ups API — Schedule and manage follow-up tasks for leads.
"""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.config import settings
from app.core.logger import logger
from app.models.models import Lead, LeadFollowUp, User
from app.schemas.schemas import FollowUpCreate, FollowUpUpdate, FollowUpOut

router = APIRouter()


@router.post("/{lead_id}/follow-ups", response_model=FollowUpOut, status_code=status.HTTP_201_CREATED)
async def create_follow_up(
    lead_id: str,
    payload: FollowUpCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")

    fu = LeadFollowUp(
        lead_id=lead_id,
        scheduled_at=payload.scheduled_at,
        method=payload.method,
        note=payload.note,
        created_by=current_user.id,
    )
    db.add(fu)
    await db.flush()
    await db.commit()
    await db.refresh(fu)
    return FollowUpOut.model_validate(fu, from_attributes=True)


@router.get("/{lead_id}/follow-ups", response_model=list[FollowUpOut])
async def list_follow_ups(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(LeadFollowUp)
        .where(LeadFollowUp.lead_id == lead_id)
        .order_by(LeadFollowUp.scheduled_at.asc())
    )
    return [FollowUpOut.model_validate(f, from_attributes=True) for f in result.scalars().all()]


@router.patch("/{lead_id}/follow-ups/{fu_id}", response_model=FollowUpOut)
async def update_follow_up(
    lead_id: str,
    fu_id: str,
    payload: FollowUpUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(LeadFollowUp).where(LeadFollowUp.id == fu_id, LeadFollowUp.lead_id == lead_id)
    )
    fu = result.scalar_one_or_none()
    if not fu:
        raise HTTPException(status_code=404, detail="Follow-up not found.")

    if payload.is_completed is not None:
        fu.is_completed = payload.is_completed
        if payload.is_completed:
            fu.completed_at = datetime.now(timezone.utc)
    if payload.note is not None:
        fu.note = payload.note

    await db.commit()
    await db.refresh(fu)

    return FollowUpOut.model_validate(fu, from_attributes=True)


@router.post("/internal/process-followups")
async def process_due_followups_internal(
    x_internal_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Called by Celery Beat every minute to dispatch overdue follow-ups."""
    if x_internal_token != settings.INTERNAL_API_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid internal token")

    from app.workers.tasks import trigger_outbound_call, send_notification

    now = datetime.now(timezone.utc)
    due = (
        await db.execute(
            select(LeadFollowUp)
            .where(LeadFollowUp.scheduled_at <= now)
            .where(LeadFollowUp.is_completed == False)
            .limit(50)
        )
    ).scalars().all()

    dispatched = 0
    for fu in due:
        lead = (await db.execute(select(Lead).where(Lead.id == fu.lead_id))).scalar_one_or_none()
        if not lead:
            fu.is_completed = True
            fu.completed_at = now
            continue

        from app.api.v1.calls import _get_active_agent_config
        agent_config = await _get_active_agent_config()
        company_name = agent_config.get("agent_company") or "iFocusSystec"
        note_text = fu.note or f"Hi {lead.full_name}, this is a follow-up from {company_name}. How can we help you?"

        try:
            if fu.method == "call":
                trigger_outbound_call.delay(lead.id, lead.phone)
            elif fu.method in ("whatsapp", "sms"):
                send_notification.delay(lead.id, fu.method, lead.phone, note_text)
            elif fu.method == "email" and lead.email:
                send_notification.delay(lead.id, "email", lead.email, note_text)
            else:
                logger.warning(f"follow-up {fu.id}: unknown method={fu.method}, skipping")
                fu.is_completed = True
                fu.completed_at = now
                continue
        except Exception as exc:
            logger.error(f"follow-up {fu.id} dispatch failed: {exc}")
            continue

        fu.is_completed = True
        fu.completed_at = now
        dispatched += 1

    await db.commit()
    logger.info(f"process_due_followups: dispatched={dispatched} total_due={len(due)}")
    return {"dispatched": dispatched, "total_due": len(due)}
