"""
Admin API — System-level operations (admin only).
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, text
from datetime import datetime, date, timezone

from app.core.database import get_db
from app.core.security import require_role
from app.models.models import Lead, Call, User, AuditLog
from app.schemas.schemas import DashboardStats

router = APIRouter()


@router.get("/dashboard/stats", response_model=DashboardStats)
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("admin", "agent")),
):
    """
    Returns high-level KPI stats for the dashboard.
    All heavy queries are cached in production via Redis.
    """
    today_start = datetime.combine(date.today(), datetime.min.time()).replace(tzinfo=timezone.utc)

    # Total leads
    total_leads = (await db.execute(select(func.count(Lead.id)))).scalar_one()

    # New leads today
    new_leads_today = (await db.execute(
        select(func.count(Lead.id)).where(Lead.created_at >= today_start)
    )).scalar_one()

    # Total calls today
    total_calls_today = (await db.execute(
        select(func.count(Call.id)).where(Call.created_at >= today_start)
    )).scalar_one()

    # Conversion rate (converted / total * 100)
    converted = (await db.execute(
        select(func.count(Lead.id)).where(Lead.status == "converted")
    )).scalar_one()
    conversion_rate = round((converted / total_leads * 100) if total_leads else 0, 2)

    # Avg call duration
    avg_duration = (await db.execute(
        select(func.avg(Call.duration_seconds)).where(Call.status.in_(["answered", "completed"]))
    )).scalar_one() or 0

    # Leads by status
    status_rows = (await db.execute(
        select(Lead.status, func.count(Lead.id)).group_by(Lead.status)
    )).all()
    leads_by_status = {row[0]: row[1] for row in status_rows}

    # Calls by direction
    direction_rows = (await db.execute(
        select(Call.direction, func.count(Call.id)).group_by(Call.direction)
    )).all()
    calls_by_direction = {row[0]: row[1] for row in direction_rows}

    return DashboardStats(
        total_leads=total_leads,
        new_leads_today=new_leads_today,
        total_calls_today=total_calls_today,
        conversion_rate=conversion_rate,
        avg_call_duration_seconds=round(avg_duration, 1),
        leads_by_status=leads_by_status,
        calls_by_direction=calls_by_direction,
        top_intents=[],  # Populated by analytics service
    )


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
