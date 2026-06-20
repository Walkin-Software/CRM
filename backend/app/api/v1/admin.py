"""
Admin API — System-level operations (admin + agent).
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from datetime import datetime, date, timedelta, timezone

from app.core.database import get_db
from app.core.security import require_role
from app.models.models import Lead, Call, AuditLog, LeadFollowUp, Notification
from app.schemas.schemas import DashboardStats, DashboardActivity, DashboardActivityPoint
from app.core.cache import cache_get_json, cache_set_json
from app.core.config import settings

router = APIRouter()


def _today_start() -> datetime:
    return datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)


def _days_ago(n: int) -> datetime:
    return _today_start() - timedelta(days=n)


@router.get("/dashboard/stats", response_model=DashboardStats)
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("admin", "agent")),
):
    """
    KPI cards for the dashboard.
    Returns aggregated stats with 7-day delta comparisons.
    Cached in Redis for DASHBOARD_CACHE_TTL_SECONDS.
    """
    cache_key = "admin:dashboard:stats:v2"
    cached = await cache_get_json(cache_key)
    if cached:
        return DashboardStats(**cached)

    today = _today_start()
    week_start = _days_ago(6)       # current 7 days: today-6 → today
    prev_week_start = _days_ago(13) # previous 7 days: today-13 → today-7
    prev_week_end = _days_ago(7)

    # ── Core counts ──────────────────────────────────────────────
    total_leads = (await db.execute(
        select(func.count(Lead.id))
    )).scalar_one()

    new_leads_today = (await db.execute(
        select(func.count(Lead.id)).where(Lead.created_at >= today)
    )).scalar_one()

    total_calls_today = (await db.execute(
        select(func.count(Call.id)).where(Call.created_at >= today)
    )).scalar_one()

    # ── Conversion ───────────────────────────────────────────────
    converted = (await db.execute(
        select(func.count(Lead.id)).where(Lead.status == "converted")
    )).scalar_one()
    conversion_rate = round((converted / total_leads * 100) if total_leads else 0, 2)

    # ── Avg call duration ────────────────────────────────────────
    avg_duration = (await db.execute(
        select(func.avg(Call.duration_seconds)).where(
            Call.status.in_(["answered", "completed"])
        )
    )).scalar_one() or 0

    # ── Leads by status ──────────────────────────────────────────
    status_rows = (await db.execute(
        select(Lead.status, func.count(Lead.id)).group_by(Lead.status)
    )).all()
    leads_by_status = {r[0]: r[1] for r in status_rows}

    # ── Calls by direction ───────────────────────────────────────
    direction_rows = (await db.execute(
        select(Call.direction, func.count(Call.id)).group_by(Call.direction)
    )).all()
    calls_by_direction = {r[0]: r[1] for r in direction_rows}

    # ── 7-day delta: leads ───────────────────────────────────────
    leads_this_week = (await db.execute(
        select(func.count(Lead.id)).where(Lead.created_at >= week_start)
    )).scalar_one()

    leads_last_week = (await db.execute(
        select(func.count(Lead.id)).where(
            and_(Lead.created_at >= prev_week_start, Lead.created_at < prev_week_end)
        )
    )).scalar_one()

    if leads_last_week > 0:
        leads_delta_pct = round((leads_this_week - leads_last_week) / leads_last_week * 100, 1)
    else:
        leads_delta_pct = 100.0 if leads_this_week > 0 else 0.0

    # ── 7-day delta: calls ───────────────────────────────────────
    calls_this_week = (await db.execute(
        select(func.count(Call.id)).where(Call.created_at >= week_start)
    )).scalar_one()

    calls_last_week = (await db.execute(
        select(func.count(Call.id)).where(
            and_(Call.created_at >= prev_week_start, Call.created_at < prev_week_end)
        )
    )).scalar_one()

    if calls_last_week > 0:
        calls_delta_pct = round((calls_this_week - calls_last_week) / calls_last_week * 100, 1)
    else:
        calls_delta_pct = 100.0 if calls_this_week > 0 else 0.0

    # ── Pending follow-ups ───────────────────────────────────────
    pending_follow_ups = (await db.execute(
        select(func.count(LeadFollowUp.id)).where(LeadFollowUp.is_completed == False)  # noqa: E712
    )).scalar_one()

    # ── Notifications sent today ─────────────────────────────────
    notifications_today = (await db.execute(
        select(func.count(Notification.id)).where(
            and_(
                Notification.created_at >= today,
                Notification.status.in_(["sent", "delivered"]),
            )
        )
    )).scalar_one()

    response = DashboardStats(
        total_leads=total_leads,
        new_leads_today=new_leads_today,
        total_calls_today=total_calls_today,
        conversion_rate=conversion_rate,
        avg_call_duration_seconds=round(avg_duration, 1),
        leads_by_status=leads_by_status,
        calls_by_direction=calls_by_direction,
        top_intents=[],
        leads_delta_pct=leads_delta_pct,
        calls_delta_pct=calls_delta_pct,
        pending_follow_ups=pending_follow_ups,
        notifications_today=notifications_today,
    )
    await cache_set_json(cache_key, response.model_dump(), settings.DASHBOARD_CACHE_TTL_SECONDS)
    return response


@router.get("/dashboard/activity", response_model=DashboardActivity)
async def get_dashboard_activity(
    days: int = Query(14, ge=7, le=90),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("admin", "agent")),
):
    """
    Daily leads + calls counts for the last N days.
    Used for the area chart on the dashboard.
    """
    cache_key = f"admin:dashboard:activity:{days}"
    cached = await cache_get_json(cache_key)
    if cached:
        return DashboardActivity(**cached)

    # Fetch leads with created_at in range
    range_start = _days_ago(days - 1)
    leads_rows = (await db.execute(
        select(Lead.created_at).where(Lead.created_at >= range_start)
    )).scalars().all()

    calls_rows = (await db.execute(
        select(Call.created_at).where(Call.created_at >= range_start)
    )).scalars().all()

    # Build a date → count dict in Python (avoids DB-specific date functions)
    leads_by_date: dict[str, int] = {}
    for dt in leads_rows:
        if dt:
            key = dt.date().isoformat() if hasattr(dt, "date") else str(dt)[:10]
            leads_by_date[key] = leads_by_date.get(key, 0) + 1

    calls_by_date: dict[str, int] = {}
    for dt in calls_rows:
        if dt:
            key = dt.date().isoformat() if hasattr(dt, "date") else str(dt)[:10]
            calls_by_date[key] = calls_by_date.get(key, 0) + 1

    # Build ordered list covering every day in the range
    today_date = date.today()
    points = []
    for i in range(days - 1, -1, -1):
        d = today_date - timedelta(days=i)
        key = d.isoformat()
        points.append(DashboardActivityPoint(
            date=key,
            leads=leads_by_date.get(key, 0),
            calls=calls_by_date.get(key, 0),
        ))

    result = DashboardActivity(items=points)
    await cache_set_json(cache_key, result.model_dump(), settings.DASHBOARD_CACHE_TTL_SECONDS)
    return result


@router.get("/audit-logs")
async def get_audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    offset = (page - 1) * page_size
    result = await db.execute(
        select(AuditLog)
        .order_by(AuditLog.created_at.desc())
        .offset(offset).limit(page_size)
    )
    logs = result.scalars().all()
    return [
        {
            "id": l.id, "user_id": l.user_id, "action": l.action,
            "entity_type": l.entity_type, "entity_id": l.entity_id,
            "old_value": l.old_value, "new_value": l.new_value,
            "ip_address": l.ip_address, "created_at": l.created_at,
        }
        for l in logs
    ]
