"""
Analytics API — Overview KPIs, daily trends, call heatmap, conversion funnel.
Replaces the dead proxy to localhost:3006 with direct DB queries.
"""
from __future__ import annotations

from datetime import datetime, date, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, and_, case, cast, Numeric
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.cache import cache_get_json, cache_set_json
from app.models.models import Lead, Call, Notification, Transaction, User

router = APIRouter()


def _days_ago(n: int) -> datetime:
    return datetime.combine(date.today() - timedelta(days=n), datetime.min.time()).replace(tzinfo=timezone.utc)


def _today_start() -> datetime:
    return datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)


# ─── Overview KPIs ────────────────────────────────────────────

@router.get("/overview")
async def analytics_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Aggregated analytics overview:
    - Total revenue (from completed transactions)
    - Conversion rate
    - Total calls (last 30 days)
    - Connection rate
    - Top lead sources
    - Hourly call distribution
    """
    cache_key = "analytics:overview:v1"
    cached = await cache_get_json(cache_key)
    if cached:
        return cached

    thirty_days_ago = _days_ago(30)
    today = _today_start()

    revenue_cents = (
        await db.execute(
            select(func.coalesce(func.sum(Transaction.amount_cents), cast(0, Numeric))).where(
                Transaction.status == "completed"
            )
        )
    ).scalar_one()
    total_revenue_inr = float(revenue_cents or 0) / 100

    # ── Leads ────────────────────────────────────────────────
    total_leads = (await db.execute(select(func.count(Lead.id)))).scalar_one()
    converted = (
        await db.execute(
            select(func.count(Lead.id)).where(Lead.status == "converted")
        )
    ).scalar_one()
    conversion_rate = round((converted / total_leads * 100) if total_leads else 0, 1)

    # ── Calls ────────────────────────────────────────────────
    total_calls = (
        await db.execute(
            select(func.count(Call.id)).where(Call.created_at >= thirty_days_ago)
        )
    ).scalar_one()
    answered_calls = (
        await db.execute(
            select(func.count(Call.id)).where(
                and_(
                    Call.created_at >= thirty_days_ago,
                    Call.status.in_(["answered", "completed"]),
                )
            )
        )
    ).scalar_one()
    connection_rate = (
        f"{round(answered_calls / total_calls * 100, 1)}%"
        if total_calls
        else "0%"
    )

    # ── Top Lead Sources ─────────────────────────────────────
    source_rows = (
        await db.execute(
            select(Lead.source, func.count(Lead.id).label("count"))
            .group_by(Lead.source)
            .order_by(func.count(Lead.id).desc())
            .limit(6)
        )
    ).all()
    top_lead_sources = [{"source": r[0] or "unknown", "count": r[1]} for r in source_rows]

    # ── Hourly Call Distribution (last 30 days) ───────────────
    hour_rows = (
        await db.execute(
            select(
                func.extract('hour', Call.created_at).label("hour"),
                func.count(Call.id).label("count"),
            )
            .where(Call.created_at >= thirty_days_ago)
            .group_by(func.extract('hour', Call.created_at))
            .order_by(func.extract('hour', Call.created_at))
        )
    ).all()
    hourly_calls = [
        {"hour": f"{int(r[0]):02d}:00", "count": r[1]} for r in hour_rows
    ]

    result = {
        "total_revenue": f"₹{total_revenue_inr:,.0f}",
        "conversion_rate": f"{conversion_rate}%",
        "total_calls": total_calls,
        "connection_rate": connection_rate,
        "top_lead_sources": top_lead_sources,
        "hourly_calls": hourly_calls,
    }

    await cache_set_json(cache_key, result, ttl_seconds=300)
    return result


# ─── Daily Trend ──────────────────────────────────────────────

@router.get("/daily")
async def analytics_daily(
    days: int = Query(14, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Day-by-day leads created and calls made for the past N days."""
    cache_key = f"analytics:daily:{days}:v1"
    cached = await cache_get_json(cache_key)
    if cached:
        return cached

    since = _days_ago(days - 1)

    lead_rows = (
        await db.execute(
            select(
                func.date(Lead.created_at).label("day"),
                func.count(Lead.id).label("leads"),
            )
            .where(Lead.created_at >= since)
            .group_by(func.date(Lead.created_at))
        )
    ).all()

    call_rows = (
        await db.execute(
            select(
                func.date(Call.created_at).label("day"),
                func.count(Call.id).label("calls"),
            )
            .where(Call.created_at >= since)
            .group_by(func.date(Call.created_at))
        )
    ).all()

    lead_map = {str(r[0]): r[1] for r in lead_rows}
    call_map = {str(r[0]): r[1] for r in call_rows}

    items = []
    for i in range(days):
        day = date.today() - timedelta(days=days - 1 - i)
        day_str = str(day)
        items.append({
            "date": day_str,
            "leads": lead_map.get(day_str, 0),
            "calls": call_map.get(day_str, 0),
        })

    result = {"items": items}
    await cache_set_json(cache_key, result, ttl_seconds=300)
    return result


# ─── Call Heatmap ─────────────────────────────────────────────

@router.get("/calls/heatmap")
async def calls_heatmap(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns a 7×24 heatmap matrix: day-of-week × hour-of-day call counts.
    day: 0=Mon … 6=Sun, hour: 0–23.
    """
    cache_key = "analytics:calls:heatmap:v1"
    cached = await cache_get_json(cache_key)
    if cached:
        return cached

    rows = (
        await db.execute(
            select(
                func.extract('dow', Call.created_at).label("dow"),
                func.extract('hour', Call.created_at).label("hour"),
                func.count(Call.id).label("count"),
            )
            .where(Call.created_at >= _days_ago(90))
            .group_by(
                func.extract('dow', Call.created_at),
                func.extract('hour', Call.created_at),
            )
        )
    ).all()

    # PostgreSQL DOW: 0=Sun, 1=Mon, ..., 6=Sat — convert to 0=Mon…6=Sun
    matrix: list[list[int]] = [[0] * 24 for _ in range(7)]
    for dow_pg, hour, count in rows:
        # dow_pg: 0=Sun, 1=Mon, …, 6=Sat → 0=Mon…6=Sun
        day_idx = (int(dow_pg) - 1) % 7
        matrix[day_idx][int(hour)] = count

    result = {"matrix": matrix}
    await cache_set_json(cache_key, result, ttl_seconds=600)
    return result


# ─── Conversion Funnel ────────────────────────────────────────

@router.get("/conversion-funnel")
async def conversion_funnel(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lead pipeline funnel by status in logical progression order."""
    cache_key = "analytics:conversion_funnel:v1"
    cached = await cache_get_json(cache_key)
    if cached:
        return cached

    status_order = [
        "new",
        "contacted",
        "qualified",
        "demo_scheduled",
        "proposal_sent",
        "converted",
    ]
    label_map = {
        "new": "Total Leads",
        "contacted": "Contacted",
        "qualified": "Qualified",
        "demo_scheduled": "Demo Scheduled",
        "proposal_sent": "Proposal Sent",
        "converted": "Converted",
    }

    rows = (
        await db.execute(
            select(Lead.status, func.count(Lead.id).label("count"))
            .group_by(Lead.status)
        )
    ).all()
    counts = {r[0]: r[1] for r in rows}

    # Total across all statuses for percentage base
    total = sum(counts.values()) or 1

    funnel = []
    for status in status_order:
        count = counts.get(status, 0)
        funnel.append({
            "stage": label_map[status],
            "count": count,
            "percentage": round(count / total * 100, 1),
        })

    result = {"funnel": funnel}
    await cache_set_json(cache_key, result, ttl_seconds=300)
    return result
