from __future__ import annotations

from datetime import datetime, timezone
import smtplib
from email.message import EmailMessage
from fastapi import APIRouter, Depends, HTTPException, Form
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from twilio.rest import Client as TwilioClient
from twilio.base.exceptions import TwilioRestException

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.config import settings
from app.models.models import User, Lead, Notification, AIScreeningSession
from app.schemas.schemas import (
    SendNotificationRequest,
    GenerateLeadMessageRequest,
    PaginatedResponse,
    NotificationOut,
)
from app.services.ai_content import generate_followup_messages

router = APIRouter()


def _webhook_base_url() -> str:
    base = (settings.TWILIO_WEBHOOK_URL or "").strip().rstrip("/")
    if base:
        return base
    return f"http://localhost:{settings.PORT}"


def _normalize_phone(value: str | None) -> str:
    if not value:
        return ""
    text = value.strip()
    if text.startswith("whatsapp:"):
        text = text.split(":", 1)[1]
    return text


def _normalize_message_status(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if raw in {"queued", "accepted", "sending", "sent"}:
        return "sent"
    if raw in {"delivered"}:
        return "delivered"
    if raw in {"read"}:
        return "read"
    if raw in {"failed", "undelivered"}:
        return "failed"
    return "pending"


def _send_via_twilio(channel: str, to: str, body: str) -> str:
    if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN:
        raise RuntimeError("Twilio credentials are not configured")

    client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    if channel == "whatsapp":
        from_number = settings.TWILIO_WHATSAPP_NUMBER or settings.TWILIO_PHONE_NUMBER
        to_number = to if to.startswith("whatsapp:") else f"whatsapp:{to}"
    else:
        from_number = settings.TWILIO_PHONE_NUMBER
        to_number = to

    if not from_number:
        raise RuntimeError("Twilio sender number is not configured")

    status_callback = f"{_webhook_base_url()}/notifications/webhooks/twilio/status"
    message = client.messages.create(
        from_=from_number,
        to=to_number,
        body=body,
        status_callback=status_callback,
    )
    return message.sid


def _send_via_smtp(to: str, body: str) -> str:
    if not settings.SMTP_HOST or not settings.SMTP_USER or not settings.SMTP_PASS:
        raise RuntimeError("SMTP credentials are not configured")

    msg = EmailMessage()
    msg["Subject"] = "Skill Lab Notification"
    msg["From"] = settings.SMTP_FROM or settings.SMTP_USER
    msg["To"] = to
    msg.set_content(body)

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
        server.starttls()
        server.login(settings.SMTP_USER, settings.SMTP_PASS)
        server.send_message(msg)
    return f"smtp-{int(datetime.now(timezone.utc).timestamp())}"


def _dispatch_message(channel: str, to: str, body: str) -> tuple[str, str | None, str | None]:
    if settings.MOCK_SERVICES:
        return "sent", f"mock-{int(datetime.now(timezone.utc).timestamp())}", None

    try:
        if channel in {"sms", "whatsapp"}:
            sid = _send_via_twilio(channel, to, body)
            return "sent", sid, None
        if channel == "email":
            sid = _send_via_smtp(to, body)
            return "sent", sid, None
        return "failed", None, f"Unsupported channel: {channel}"
    except (TwilioRestException, RuntimeError, smtplib.SMTPException) as exc:
        return "failed", None, str(exc)


@router.get("/templates")
async def list_templates(current_user: User = Depends(get_current_user)):
    return {
        "templates": [
            {"name": "Lead Welcome", "preview": "Hi {name}, thanks for your interest in Skill Lab."},
            {"name": "Screening Follow-up", "preview": "Hi {name}, we reviewed your screening answers."},
            {"name": "Demo Reminder", "preview": "Your demo is confirmed for {date_time}."},
        ]
    }


@router.post("/send")
async def send_notification(
    payload: SendNotificationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    status, external_sid, error_message = _dispatch_message(payload.channel, payload.to, payload.body)

    notif = Notification(
        lead_id=payload.lead_id,
        channel=payload.channel,
        recipient_phone=payload.to if payload.channel in {"sms", "whatsapp"} else None,
        recipient_email=payload.to if payload.channel == "email" else None,
        content=payload.body,
        status=status,
        external_sid=external_sid,
        error_message=error_message,
        sent_at=datetime.now(timezone.utc) if status == "sent" else None,
    )
    db.add(notif)
    await db.commit()
    await db.refresh(notif)

    if status != "sent":
        raise HTTPException(status_code=502, detail=error_message or "Failed to send notification")

    return {
        "status": "sent",
        "channel": payload.channel,
        "to": payload.to,
        "mock": settings.MOCK_SERVICES,
        "id": notif.id,
    }


@router.post("/generate-and-send")
async def generate_and_send(
    payload: GenerateLeadMessageRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = (await db.execute(select(Lead).where(Lead.id == payload.lead_id))).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    latest_screening = (
        await db.execute(
            select(AIScreeningSession)
            .where(AIScreeningSession.lead_id == lead.id)
            .order_by(AIScreeningSession.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    answers = latest_screening.answers if latest_screening else []

    sms_msg, email_msg = await generate_followup_messages(
        full_name=lead.full_name,
        email=lead.email,
        phone=lead.phone,
        job_role=lead.job_role,
        years_experience=lead.years_experience,
        answers=answers,
    )

    sms_status, sms_sid, sms_error = _dispatch_message("sms", lead.phone, sms_msg)
    rows = [
        Notification(
            lead_id=lead.id,
            channel="sms",
            recipient_phone=lead.phone,
            content=sms_msg,
            status=sms_status,
            external_sid=sms_sid,
            error_message=sms_error,
            sent_at=datetime.now(timezone.utc) if sms_status == "sent" else None,
        )
    ]

    email_status = None
    email_sid = None
    email_error = None
    if lead.email:
        email_status, email_sid, email_error = _dispatch_message("email", lead.email, email_msg)
        rows.append(
            Notification(
                lead_id=lead.id,
                channel="email",
                recipient_email=lead.email,
                content=email_msg,
                status=email_status,
                external_sid=email_sid,
                error_message=email_error,
                sent_at=datetime.now(timezone.utc) if email_status == "sent" else None,
            )
        )

    db.add_all(rows)

    if latest_screening:
        latest_screening.ai_sms_message = sms_msg
        latest_screening.ai_email_message = email_msg

    await db.commit()

    if sms_status != "sent":
        raise HTTPException(status_code=502, detail=sms_error or "SMS sending failed")

    return {
        "lead_id": lead.id,
        "sms": sms_msg,
        "email": email_msg,
        "channels_sent": ["sms"] + (["email"] if lead.email and email_status == "sent" else []),
        "sms_status": sms_status,
        "sms_sid": sms_sid,
        "email_status": email_status,
        "email_sid": email_sid,
    }


@router.get("/history", response_model=PaginatedResponse)
async def notification_history(
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(Notification).order_by(Notification.created_at.desc())
    total = (await db.execute(select(func.count()).select_from(Notification))).scalar_one()
    rows = (
        await db.execute(query.offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [NotificationOut.model_validate(row, from_attributes=True) for row in rows],
    }


@router.post("/webhooks/twilio/status")
async def twilio_message_status_webhook(
    MessageSid: str = Form(...),
    MessageStatus: str = Form(...),
    ErrorCode: str | None = Form(None),
    ErrorMessage: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    notif = (await db.execute(select(Notification).where(Notification.external_sid == MessageSid))).scalar_one_or_none()
    if not notif:
        return {"status": "ignored", "reason": "notification_not_found", "message_sid": MessageSid}

    notif.status = _normalize_message_status(MessageStatus)
    if notif.status == "delivered":
        notif.delivered_at = datetime.now(timezone.utc)
    if notif.status == "failed":
        notif.error_message = (ErrorMessage or ErrorCode or "Twilio delivery failed")

    await db.commit()
    return {"status": "ok", "notification_id": notif.id, "message_status": notif.status}


@router.post("/webhooks/twilio/inbound")
async def twilio_inbound_message_webhook(
    From: str = Form(...),
    To: str | None = Form(None),
    Body: str | None = Form(None),
    MessageSid: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    from_number = _normalize_phone(From)
    channel = "whatsapp" if (From or "").startswith("whatsapp:") else "sms"

    lead = None
    if from_number:
        lead = (
            await db.execute(select(Lead).where(Lead.phone == from_number).limit(1))
        ).scalar_one_or_none()

    notif = Notification(
        lead_id=lead.id if lead else None,
        channel=channel,
        recipient_phone=from_number or None,
        content=(Body or "").strip() or "(empty inbound message)",
        status="read",
        external_sid=MessageSid,
        sent_at=datetime.now(timezone.utc),
        delivered_at=datetime.now(timezone.utc),
    )
    db.add(notif)
    await db.commit()

    return {
        "status": "ok",
        "lead_id": lead.id if lead else None,
        "channel": channel,
        "from": from_number,
        "to": _normalize_phone(To),
    }
