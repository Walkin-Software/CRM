"""
Visitor Intelligence API — Real-time website visitor tracking.
/visitors/track  (public, no auth) — called by the tracking pixel/beacon.
/visitors        (auth required)   — list active sessions for the dashboard.
/visitors/{id}/convert             — convert a visitor session into a lead.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import VisitorSession, Lead, User

router = APIRouter()

# Consider a session "active" if last_seen within this window
ACTIVE_MINUTES = 5


class TrackPayload(BaseModel):
    session_token: Optional[str] = None
    page: str
    source: Optional[str] = None
    referrer: Optional[str] = None
    browser: Optional[str] = None
    device: Optional[str] = None
    os: Optional[str] = None
    screen: Optional[str] = None


class ConvertPayload(BaseModel):
    full_name: str
    phone: str
    email: Optional[str] = None
    interest: Optional[str] = None


def _session_out(s: VisitorSession) -> dict:
    now = datetime.now(timezone.utc)
    last_seen = s.last_seen_at
    if last_seen and last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    is_active = (now - last_seen).total_seconds() < ACTIVE_MINUTES * 60 if last_seen else False
    duration_s = s.duration_seconds or 0
    duration_str = f"{duration_s // 60}m {duration_s % 60}s"

    return {
        "id": s.id,
        "ip": s.ip_address or "—",
        "location": s.location or "Unknown",
        "source": s.source or "Direct",
        "page": s.current_page or "/",
        "duration": duration_str,
        "browser": s.browser or "Unknown",
        "device": s.device or "Desktop",
        "os": s.os or "Unknown",
        "screen": s.screen or "—",
        "isp": s.isp or "—",
        "coordinates": s.coordinates or "—",
        "journey": s.journey or [],
        "is_active": is_active,
        "converted_lead_id": s.converted_lead_id,
        "last_seen_at": s.last_seen_at.isoformat() if s.last_seen_at else None,
        "created_at": s.created_at.isoformat(),
    }


# ─── Public Tracking Endpoint ─────────────────────────────────

@router.post("/track")
async def track_visitor(
    payload: TrackPayload,
    request_obj=None,
    db: AsyncSession = Depends(get_db),
):
    """
    Called by the frontend tracking beacon on every page load.
    No authentication required — public endpoint.
    Creates or updates a VisitorSession.
    """
    token = payload.session_token or secrets.token_urlsafe(32)

    session = (
        await db.execute(
            select(VisitorSession).where(VisitorSession.session_token == token)
        )
    ).scalar_one_or_none()

    now = datetime.now(timezone.utc)

    if session:
        # Update journey
        journey = session.journey or []
        if journey and journey[-1].get("page") == payload.page:
            journey[-1]["time"] = "Active Now"
        else:
            # Mark previous last as time-ago
            if journey:
                journey[-1]["time"] = "1m ago"
            journey.append({"page": payload.page, "time": "Active Now"})
        session.journey = journey
        session.current_page = payload.page
        session.duration_seconds = int((now - session.created_at.replace(tzinfo=timezone.utc) if session.created_at.tzinfo is None else now - session.created_at).total_seconds())
        session.last_seen_at = now
        if payload.source:
            session.source = payload.source
    else:
        session = VisitorSession(
            session_token=token,
            source=payload.source,
            current_page=payload.page,
            browser=payload.browser,
            device=payload.device,
            os=payload.os,
            screen=payload.screen,
            journey=[{"page": payload.page, "time": "Active Now"}],
            is_active=True,
            last_seen_at=now,
        )
        db.add(session)

    await db.commit()
    await db.refresh(session)
    return {"session_token": session.session_token, "session_id": session.id}


# ─── List Active Visitors ─────────────────────────────────────

@router.get("")
async def list_visitors(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=ACTIVE_MINUTES if active_only else 1440)
    query = select(VisitorSession).where(VisitorSession.last_seen_at >= cutoff)

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar_one()

    offset = (page - 1) * page_size
    result = await db.execute(
        query.order_by(VisitorSession.last_seen_at.desc()).offset(offset).limit(page_size)
    )
    sessions = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_session_out(s) for s in sessions],
    }


# ─── Convert Visitor → Lead ───────────────────────────────────

@router.post("/{session_id}/convert")
async def convert_visitor(
    session_id: str,
    payload: ConvertPayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Turn an anonymous visitor session into a CRM lead."""
    session = (
        await db.execute(select(VisitorSession).where(VisitorSession.id == session_id))
    ).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Visitor session not found")

    if session.converted_lead_id:
        return {"lead_id": session.converted_lead_id, "already_converted": True}

    lead = Lead(
        full_name=payload.full_name,
        phone=payload.phone,
        email=payload.email,
        interest=payload.interest,
        source="web_form",
        lead_type="form",
        utm_source=session.source,
    )
    db.add(lead)
    await db.flush()
    session.converted_lead_id = lead.id
    await db.commit()
    return {"lead_id": lead.id, "already_converted": False}
