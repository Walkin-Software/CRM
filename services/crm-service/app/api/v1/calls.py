from typing import Optional
from datetime import datetime, timezone
import asyncio
from fastapi import APIRouter, Depends, Query, BackgroundTasks, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import Call, User, Lead
from app.schemas.schemas import PaginatedResponse, CallOut, OutboundCallRequest
from app.services.ai_content import generate_call_opening

router = APIRouter()

@router.get("", response_model=PaginatedResponse)
@router.get("/", response_model=PaginatedResponse)
async def list_calls(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
    direction: Optional[str] = Query(None),
    lead_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List call history with filtering and pagination."""
    query = select(Call)

    if status:
        query = query.where(Call.status == status)
    if direction:
        query = query.where(Call.direction == direction)
    if lead_id:
        query = query.where(Call.lead_id == lead_id)

    # Count total
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar_one()

    # Paginate
    offset = (page - 1) * page_size
    query = query.order_by(Call.created_at.desc()).offset(offset).limit(page_size)
    result = await db.execute(query)
    calls = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [CallOut.model_validate(c, from_attributes=True) for c in calls],
    }

async def delayed_call_trigger(lead_id: str, to_number: str, delay_seconds: float):
    if delay_seconds > 0:
        await asyncio.sleep(delay_seconds)
    
    import httpx
    async with httpx.AsyncClient() as client:
        try:
            await client.post("http://localhost:3001/calls/outbound", json={
                "lead_id": lead_id,
                "to_number": to_number,
                "agent_id": "default"
            }, timeout=5.0)
        except Exception as e:
            print(f"Scheduled call failed: {e}")

@router.post("/scheduled")
async def schedule_call(
    lead_id: str,
    to_number: str,
    scheduled_at: datetime,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    """Schedules a call to be made at a specific time."""
    now = datetime.now(timezone.utc)
    # Ensure scheduled_at is timezone-aware
    if scheduled_at.tzinfo is None:
        scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
        
    delay = (scheduled_at - now).total_seconds()
    
    if delay < 0:
        raise HTTPException(status_code=400, detail="Scheduled time must be in the future.")
    
    background_tasks.add_task(delayed_call_trigger, lead_id, to_number, delay)
    return {"status": "scheduled", "delay_seconds": delay, "scheduled_at": scheduled_at}


@router.post("/outbound")
async def outbound_call(
    payload: OutboundCallRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = (await db.execute(select(Lead).where(Lead.id == payload.lead_id))).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    to_number = payload.to_number or lead.phone
    ai_script = payload.message or await generate_call_opening(
        full_name=lead.full_name,
        interest=lead.interest,
        job_role=lead.job_role,
        years_experience=lead.years_experience,
    )

    call = Call(
        lead_id=lead.id,
        direction="outbound",
        status="completed",
        from_number="+10000000000",
        to_number=to_number,
        duration_seconds=95,
        handled_by="ai",
        metadata_={"ai_script": ai_script, "source": "crm_outbound"},
    )
    db.add(call)

    if lead.status == "new":
        lead.status = "contacted"

    await db.commit()
    await db.refresh(call)

    return {
        "call_id": call.id,
        "lead_id": lead.id,
        "status": call.status,
        "ai_script": ai_script,
        "to_number": to_number,
    }
