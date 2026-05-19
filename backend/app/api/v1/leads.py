"""
Leads API — Full CRUD for lead management with filtering, search, and pagination.
"""

from typing import Optional
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import Lead, User, AuditLog
from app.schemas.schemas import LeadCreate, LeadUpdate, LeadOut, PaginatedResponse
from app.core.logger import logger
from app.services.lead_automation import trigger_lead_automation

router = APIRouter()


def _default_temperature(score: int) -> str:
    if score >= 70:
        return "hot"
    if score >= 40:
        return "warm"
    return "cold"


# ─── List & Search Leads ──────────────────────────────────────

@router.get("", response_model=PaginatedResponse)
async def list_leads(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=1000),
    status: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    assigned_to: Optional[str] = Query(None),
    search: Optional[str] = Query(None, description="Search by name, email, or interest"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List leads with optional filtering, search, and pagination."""
    query = select(Lead).options(selectinload(Lead.assigned_user))

    # Apply filters
    if status:
        query = query.where(Lead.status == status)
    if source:
        query = query.where(Lead.source == source)
    if assigned_to:
        query = query.where(Lead.assigned_to == assigned_to)
    if search:
        pattern = f"%{search}%"
        query = query.where(
            or_(
                Lead.full_name.ilike(pattern),
                Lead.email.ilike(pattern),
                Lead.interest.ilike(pattern),
                Lead.phone.ilike(pattern),
            )
        )

    # Count total
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar_one()

    # Paginate
    offset = (page - 1) * page_size
    query = query.order_by(Lead.created_at.desc()).offset(offset).limit(page_size)
    result = await db.execute(query)
    leads = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [LeadOut.model_validate(lead, from_attributes=True) for lead in leads],
    }


@router.post("", response_model=LeadOut, status_code=status.HTTP_201_CREATED)
async def create_lead(
    payload: LeadCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new lead."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    duplicate = (
        await db.execute(
            select(Lead)
            .where(Lead.phone == payload.phone)
            .where(Lead.created_at >= cutoff)
            .order_by(Lead.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if duplicate:
        return LeadOut.model_validate(duplicate, from_attributes=True)

    lead = Lead(
        full_name=payload.full_name,
        phone=payload.phone,
        email=payload.email,
        interest=payload.interest,
        description=payload.description,
        lead_type=payload.lead_type or "form",
        job_role=payload.job_role,
        years_experience=payload.years_experience,
        source=payload.source or "manual",
        status=payload.status or "new",
        assigned_to=payload.assigned_to,
        tags=payload.tags or [],
        lead_score=payload.lead_score or 0,
        lead_temperature=payload.lead_temperature or _default_temperature(payload.lead_score or 0),
        campaign_id=payload.campaign_id,
        utm_source=payload.utm_source,
        utm_medium=payload.utm_medium,
        utm_campaign=payload.utm_campaign,
        keyword=payload.keyword,
        conversion_source=payload.conversion_source,
        custom_metadata=payload.custom_metadata or {},
    )
    db.add(lead)
    await db.flush()

    # Audit
    db.add(AuditLog(
        user_id=current_user.id,
        action="lead.create",
        entity_type="lead",
        entity_id=lead.id,
        new_value={"full_name": lead.full_name, "phone": lead.phone, "status": lead.status},
    ))

    await db.commit()
    await db.refresh(lead, ["assigned_user"])
    logger.info(f"Lead created: {lead.id} by user {current_user.id}")

    # ─── Automatic Triggers ──────────────────────────────────
    try:
        await trigger_lead_automation(db, lead)
        await db.commit()
    except Exception as e:
        logger.error(f"Failed to trigger automatic actions for lead {lead.id}: {e}")

    return LeadOut.model_validate(lead, from_attributes=True)

@router.post("/public", response_model=LeadOut, status_code=status.HTTP_201_CREATED)
async def public_create_lead(
    payload: LeadCreate,
    db: AsyncSession = Depends(get_db)
):
    """Public endpoint for website forms to create a lead and trigger actions."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    duplicate = (
        await db.execute(
            select(Lead)
            .where(Lead.phone == payload.phone)
            .where(Lead.created_at >= cutoff)
            .order_by(Lead.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if duplicate:
        return LeadOut.model_validate(duplicate, from_attributes=True)

    lead = Lead(
        full_name=payload.full_name,
        phone=payload.phone,
        email=payload.email,
        interest=payload.interest,
        description=payload.description,
        lead_type=payload.lead_type or "form",
        job_role=payload.job_role,
        years_experience=payload.years_experience,
        source="web_form",
        status="new",
        tags=["public_trigger"],
        lead_score=payload.lead_score or 0,
        lead_temperature=payload.lead_temperature or _default_temperature(payload.lead_score or 0),
        campaign_id=payload.campaign_id,
        utm_source=payload.utm_source,
        utm_medium=payload.utm_medium,
        utm_campaign=payload.utm_campaign,
        keyword=payload.keyword,
        conversion_source=payload.conversion_source,
    )
    db.add(lead)
    await db.commit()
    await db.refresh(lead)
    
    # Triggers
    try:
        await trigger_lead_automation(db, lead)
        await db.commit()
    except Exception as e:
        logger.error(f"Public trigger failed: {e}")

    return LeadOut.model_validate(lead, from_attributes=True)
@router.get("/{lead_id}", response_model=LeadOut)
async def get_lead(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single lead by ID."""
    result = await db.execute(
        select(Lead).where(Lead.id == lead_id).options(selectinload(Lead.assigned_user))
    )
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    return LeadOut.model_validate(lead, from_attributes=True)


@router.patch("/{lead_id}", response_model=LeadOut)
async def update_lead(
    lead_id: str,
    payload: LeadUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Partially update a lead."""
    result = await db.execute(
        select(Lead).where(Lead.id == lead_id).options(selectinload(Lead.assigned_user))
    )
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")

    old_values = {"status": lead.status, "assigned_to": lead.assigned_to}

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(lead, field, value)

    # Audit the change
    db.add(AuditLog(
        user_id=current_user.id,
        action="lead.update",
        entity_type="lead",
        entity_id=lead_id,
        old_value=old_values,
        new_value=update_data,
    ))

    await db.commit()
    await db.refresh(lead, ["assigned_user"])
    return LeadOut.model_validate(lead, from_attributes=True)


@router.delete("/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lead(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a lead (admin only)."""
    if current_user.role.name != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")

    result = await db.execute(select(Lead).where(Lead.id == lead_id))
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")

    await db.delete(lead)
    await db.commit()
    logger.info(f"Lead deleted: {lead_id} by admin {current_user.id}")
