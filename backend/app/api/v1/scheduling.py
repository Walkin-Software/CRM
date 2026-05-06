from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import TimeSlot, Booking, Lead, User

router = APIRouter()


class TimeSlotCreate(BaseModel):
    agent_id: Optional[str] = None
    starts_at: datetime
    ends_at: datetime


class BookingCreate(BaseModel):
    slot_id: str
    lead_id: str
    notes: Optional[str] = None


@router.get("/slots/available")
async def available_slots(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(TimeSlot)
        .where(TimeSlot.is_available == True)
        .where(TimeSlot.starts_at >= now)
        .order_by(TimeSlot.starts_at.asc())
    )
    slots = result.scalars().all()
    return {
        "slots": [
            {
                "id": s.id,
                "agent_id": s.agent_id or "unassigned",
                "starts_at": s.starts_at,
                "ends_at": s.ends_at,
            }
            for s in slots
        ]
    }


@router.post("/slots")
async def create_slot(
    payload: TimeSlotCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.ends_at <= payload.starts_at:
        raise HTTPException(status_code=400, detail="ends_at must be after starts_at")

    slot = TimeSlot(
        agent_id=payload.agent_id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        is_available=True,
    )
    db.add(slot)
    await db.commit()
    await db.refresh(slot)
    return {"id": slot.id, "starts_at": slot.starts_at, "ends_at": slot.ends_at}


@router.post("/bookings")
async def create_booking(
    payload: BookingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    slot = (await db.execute(select(TimeSlot).where(TimeSlot.id == payload.slot_id))).scalar_one_or_none()
    if not slot or not slot.is_available:
        raise HTTPException(status_code=404, detail="Slot not available")

    lead = (await db.execute(select(Lead).where(Lead.id == payload.lead_id))).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    booking = Booking(
        slot_id=slot.id,
        lead_id=lead.id,
        booked_by=current_user.id,
        status="confirmed",
        notes=payload.notes,
    )
    slot.is_available = False
    if lead.status in {"new", "contacted", "qualified"}:
        lead.status = "demo_scheduled"

    db.add(booking)
    await db.commit()
    await db.refresh(booking)

    return {
        "id": booking.id,
        "slot_id": booking.slot_id,
        "lead_id": booking.lead_id,
        "status": booking.status,
        "meeting_link": booking.meeting_link,
    }


@router.patch("/bookings/{booking_id}")
async def update_booking(
    booking_id: str,
    status: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    booking = (await db.execute(select(Booking).where(Booking.id == booking_id))).scalar_one_or_none()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    valid = {"pending", "confirmed", "cancelled", "completed", "no_show"}
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid status, expected one of {sorted(valid)}")

    booking.status = status
    await db.commit()
    await db.refresh(booking)
    return {"id": booking.id, "status": booking.status}
