"""
Support Tickets API — Full CRUD for customer support ticket management.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import SupportTicket, User

router = APIRouter()

# SLA windows by priority (minutes)
SLA_MINUTES = {"High": 15, "Medium": 240, "Low": 1440}


class TicketCreate(BaseModel):
    subject: str
    description: Optional[str] = None
    customer_name: str
    customer_email: Optional[str] = None
    lead_id: Optional[str] = None
    priority: str = "Medium"


class TicketUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    description: Optional[str] = None
    assigned_to: Optional[str] = None


def _ticket_out(t: SupportTicket) -> dict:
    now = datetime.now(timezone.utc)
    sla_due = t.sla_due_at
    if sla_due and sla_due.tzinfo is None:
        sla_due = sla_due.replace(tzinfo=timezone.utc)

    if t.status == "Resolved":
        time_limit = "SLA Met"
    elif sla_due:
        diff = sla_due - now
        total_mins = int(diff.total_seconds() / 60)
        if total_mins < 0:
            time_limit = "SLA Breached"
        elif total_mins < 60:
            time_limit = f"{total_mins}m left"
        else:
            time_limit = f"{total_mins // 60}h remaining"
    else:
        time_limit = "—"

    color_map = {"High": "#ef4444", "Medium": "#f97316", "Low": "#16a34a"}
    bg_map = {
        "High": "rgba(239, 68, 68, 0.08)",
        "Medium": "rgba(249, 115, 22, 0.08)",
        "Low": "rgba(22, 163, 74, 0.08)",
    }
    priority = t.priority or "Medium"
    return {
        "id": t.id,
        "subject": t.subject,
        "description": t.description or "",
        "customer": t.customer_name,
        "customer_email": t.customer_email,
        "lead_id": t.lead_id,
        "priority": priority,
        "status": t.status,
        "color": color_map.get(priority, "#f97316"),
        "bg": bg_map.get(priority, "rgba(249, 115, 22, 0.08)"),
        "time_limit": time_limit,
        "sla_due_at": t.sla_due_at.isoformat() if t.sla_due_at else None,
        "created_at": t.created_at.isoformat(),
        "updated_at": t.updated_at.isoformat(),
    }


# ─── Stats ────────────────────────────────────────────────────

@router.get("/stats")
async def ticket_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    total = (await db.execute(select(func.count(SupportTicket.id)))).scalar_one()
    open_count = (
        await db.execute(
            select(func.count(SupportTicket.id)).where(SupportTicket.status == "Open")
        )
    ).scalar_one()
    in_progress = (
        await db.execute(
            select(func.count(SupportTicket.id)).where(SupportTicket.status == "In Progress")
        )
    ).scalar_one()
    resolved = (
        await db.execute(
            select(func.count(SupportTicket.id)).where(SupportTicket.status == "Resolved")
        )
    ).scalar_one()

    now = datetime.now(timezone.utc)
    breached = (
        await db.execute(
            select(func.count(SupportTicket.id)).where(
                SupportTicket.sla_due_at < now,
                SupportTicket.status.not_in(["Resolved", "Closed"]),
            )
        )
    ).scalar_one()

    sla_met_rate = round((resolved / total * 100) if total else 0, 1)

    return {
        "active_tickets": open_count + in_progress,
        "open": open_count,
        "in_progress": in_progress,
        "resolved": resolved,
        "total": total,
        "sla_breached": breached,
        "sla_met_rate": f"{sla_met_rate}%",
        "avg_response_time": "14m",  # Extend with real timing data later
    }


# ─── List Tickets ─────────────────────────────────────────────

@router.get("")
async def list_tickets(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(SupportTicket)
    if status:
        query = query.where(SupportTicket.status == status)
    if priority:
        query = query.where(SupportTicket.priority == priority)
    if search:
        pattern = f"%{search}%"
        query = query.where(
            or_(
                SupportTicket.subject.ilike(pattern),
                SupportTicket.customer_name.ilike(pattern),
            )
        )

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar_one()

    offset = (page - 1) * page_size
    result = await db.execute(
        query.order_by(SupportTicket.created_at.desc()).offset(offset).limit(page_size)
    )
    tickets = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_ticket_out(t) for t in tickets],
    }


# ─── Create Ticket ────────────────────────────────────────────

@router.post("", status_code=201)
async def create_ticket(
    payload: TicketCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.priority not in SLA_MINUTES:
        raise HTTPException(status_code=400, detail="Invalid priority. Use High, Medium, or Low.")

    sla_due = datetime.now(timezone.utc) + timedelta(minutes=SLA_MINUTES[payload.priority])
    ticket = SupportTicket(
        subject=payload.subject,
        description=payload.description,
        customer_name=payload.customer_name,
        customer_email=payload.customer_email,
        lead_id=payload.lead_id,
        priority=payload.priority,
        status="Open",
        sla_due_at=sla_due,
    )
    db.add(ticket)
    await db.commit()
    await db.refresh(ticket)
    return _ticket_out(ticket)


# ─── Get Ticket ───────────────────────────────────────────────

@router.get("/{ticket_id}")
async def get_ticket(
    ticket_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ticket = (
        await db.execute(select(SupportTicket).where(SupportTicket.id == ticket_id))
    ).scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return _ticket_out(ticket)


# ─── Update Ticket ────────────────────────────────────────────

@router.patch("/{ticket_id}")
async def update_ticket(
    ticket_id: str,
    payload: TicketUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ticket = (
        await db.execute(select(SupportTicket).where(SupportTicket.id == ticket_id))
    ).scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if payload.status:
        ticket.status = payload.status
        if payload.status in ("Resolved", "Closed") and not ticket.resolved_at:
            ticket.resolved_at = datetime.now(timezone.utc)
    if payload.priority:
        ticket.priority = payload.priority
    if payload.description is not None:
        ticket.description = payload.description
    if payload.assigned_to is not None:
        ticket.assigned_to = payload.assigned_to

    await db.commit()
    await db.refresh(ticket)
    return _ticket_out(ticket)


# ─── Delete Ticket ────────────────────────────────────────────

@router.delete("/{ticket_id}", status_code=204)
async def delete_ticket(
    ticket_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ticket = (
        await db.execute(select(SupportTicket).where(SupportTicket.id == ticket_id))
    ).scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    await db.delete(ticket)
    await db.commit()
