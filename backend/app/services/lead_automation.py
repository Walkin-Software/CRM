from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Lead, Call, Notification
from app.services.ai_content import generate_call_opening, generate_followup_messages
from app.workers.tasks import trigger_outbound_call, send_notification


async def trigger_lead_automation(db: AsyncSession, lead: Lead) -> None:
    """Create queue-backed lead automation records and trigger outbound call worker."""
    ai_script = await generate_call_opening(
        full_name=lead.full_name,
        interest=lead.interest,
        job_role=lead.job_role,
        years_experience=lead.years_experience,
    )

    sms_message, email_message = await generate_followup_messages(
        full_name=lead.full_name,
        email=lead.email,
        phone=lead.phone,
        job_role=lead.job_role,
        years_experience=lead.years_experience,
        answers=[],
    )

    outbound_call = Call(
        lead_id=lead.id,
        direction="outbound",
        status="initiated",
        from_number="+10000000000",
        to_number=lead.phone,
        duration_seconds=0,
        handled_by="ai",
        metadata_={"type": "auto_trigger", "ai_script": ai_script, "queued": True, "retry_attempt": 0},
    )
    db.add(outbound_call)

    sms = Notification(
        lead_id=lead.id,
        channel="sms",
        recipient_phone=lead.phone,
        content=sms_message,
        status="pending",
        external_sid=f"queued-sms-{lead.id[:8]}",
        scheduled_at=datetime.now(timezone.utc),
    )
    db.add(sms)

    if lead.email:
        email = Notification(
            lead_id=lead.id,
            channel="email",
            recipient_email=lead.email,
            content=email_message,
            status="pending",
            external_sid=f"queued-email-{lead.id[:8]}",
            scheduled_at=datetime.now(timezone.utc),
        )
        db.add(email)

    try:
        trigger_outbound_call.delay(lead.id, lead.phone, ai_script)
    except Exception:
        # Keep DB transaction healthy even if queue is temporarily unavailable.
        pass

    try:
        send_notification.delay(lead.id, "sms", lead.phone, sms_message)
        if lead.email:
            send_notification.delay(lead.id, "email", lead.email, email_message)
    except Exception:
        # Notification worker can be temporarily unavailable; DB records preserve intent.
        pass
