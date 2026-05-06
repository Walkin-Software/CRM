"""
Follow-ups API — Schedule and manage follow-up tasks for leads.
"""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import get_current_user
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
