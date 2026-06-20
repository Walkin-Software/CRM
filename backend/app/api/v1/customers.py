"""
Customers API — Manages converted leads as customer accounts.
Customers = Leads with status="converted". No separate table needed.
"""
from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, cast, Numeric
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import Lead, Transaction, User
from app.schemas.schemas import PaginatedResponse

router = APIRouter()


# ─── Stats ────────────────────────────────────────────────────

@router.get("/stats")
async def customer_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """KPI summary: active count, MRR, churn, satisfaction proxy."""
    total = (
        await db.execute(
            select(func.count(Lead.id)).where(Lead.status == "converted")
        )
    ).scalar_one()

    # MRR approximation: sum of completed transactions this month
    from datetime import date, timedelta, datetime, timezone
    month_start = datetime.combine(date.today().replace(day=1), datetime.min.time()).replace(tzinfo=timezone.utc)
    mrr_cents = (
        await db.execute(
            select(func.coalesce(func.sum(Transaction.amount_cents), cast(0, Numeric))).where(
                Transaction.status == "completed",
                Transaction.created_at >= month_start,
            )
        )
    ).scalar_one()

    hot_customers = (
        await db.execute(
            select(func.count(Lead.id)).where(
                Lead.status == "converted",
                Lead.lead_temperature == "hot",
            )
        )
    ).scalar_one()

    return {
        "active_contracts": total,
        "total_mrr_inr": float(mrr_cents or 0) / 100,
        "total_mrr_formatted": f"₹{float(mrr_cents or 0) / 100:,.0f}",
        "vip_customers": hot_customers,
        "satisfaction_score": 92,  # Placeholder — extend with ratings model later
    }


# ─── List Customers ───────────────────────────────────────────

@router.get("")
async def list_customers(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all converted leads as customer records with pagination."""
    from sqlalchemy import or_
    query = select(Lead).where(Lead.status == "converted")

    if search:
        pattern = f"%{search}%"
        query = query.where(
            or_(
                Lead.full_name.ilike(pattern),
                Lead.email.ilike(pattern),
                Lead.phone.ilike(pattern),
            )
        )

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar_one()

    offset = (page - 1) * page_size
    result = await db.execute(
        query.order_by(Lead.updated_at.desc()).offset(offset).limit(page_size)
    )
    leads = result.scalars().all()

    items = []
    for lead in leads:
        items.append({
            "id": lead.id,
            "name": lead.full_name,
            "phone": lead.phone,
            "email": lead.email,
            "plan": "Enterprise" if (lead.lead_score or 0) >= 70 else "Standard",
            "joined": lead.updated_at.strftime("%b %d, %Y") if lead.updated_at else "—",
            "status": "Active" if lead.lead_temperature in ("hot", "warm") else "Inactive",
            "temperature": lead.lead_temperature,
            "score": lead.lead_score,
            "interest": lead.interest,
            "notes": lead.description or "",
            "source": lead.source,
        })

    return {"total": total, "page": page, "page_size": page_size, "items": items}


# ─── Get Customer ─────────────────────────────────────────────

@router.get("/{customer_id}")
async def get_customer(
    customer_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = (
        await db.execute(select(Lead).where(Lead.id == customer_id, Lead.status == "converted"))
    ).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Customer not found")

    return {
        "id": lead.id,
        "name": lead.full_name,
        "phone": lead.phone,
        "email": lead.email,
        "plan": "Enterprise" if (lead.lead_score or 0) >= 70 else "Standard",
        "joined": lead.updated_at.strftime("%b %d, %Y") if lead.updated_at else "—",
        "status": "Active" if lead.lead_temperature in ("hot", "warm") else "Inactive",
        "temperature": lead.lead_temperature,
        "score": lead.lead_score,
        "interest": lead.interest,
        "notes": lead.description or "",
        "source": lead.source,
        "tags": lead.tags or [],
    }


# ─── Update Customer Notes ────────────────────────────────────

@router.patch("/{customer_id}")
async def update_customer(
    customer_id: str,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update customer notes/description on the underlying lead record."""
    lead = (
        await db.execute(select(Lead).where(Lead.id == customer_id, Lead.status == "converted"))
    ).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Customer not found")

    if "notes" in payload:
        lead.description = payload["notes"]

    await db.commit()
    await db.refresh(lead)
    return {"id": lead.id, "notes": lead.description}
