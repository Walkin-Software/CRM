from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import Lead, Call, Notification
from app.services.ai_content import generate_call_opening, generate_followup_messages


async def trigger_lead_automation(db: AsyncSession, lead: Lead) -> None:
    """Create AI call and AI-generated notifications in the same DB transaction."""
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
        status="completed",
        from_number="+10000000000",
        to_number=lead.phone,
        duration_seconds=90,
        handled_by="ai",
        metadata_={"type": "auto_trigger", "ai_script": ai_script},
    )
    db.add(outbound_call)

    sms = Notification(
        lead_id=lead.id,
        channel="sms",
        recipient_phone=lead.phone,
        content=sms_message,
        status="sent",
        sent_at=datetime.now(timezone.utc),
        external_sid=f"auto-sms-{lead.id[:8]}",
    )
    db.add(sms)

    if lead.email:
        email = Notification(
            lead_id=lead.id,
            channel="email",
            recipient_email=lead.email,
            content=email_message,
            status="sent",
            sent_at=datetime.now(timezone.utc),
            external_sid=f"auto-email-{lead.id[:8]}",
        )
        db.add(email)
