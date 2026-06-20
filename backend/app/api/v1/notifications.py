from __future__ import annotations

from datetime import datetime, timezone
import smtplib
from email.message import EmailMessage
from fastapi import APIRouter, Depends, HTTPException, Form, Header
from sqlalchemy import select, func, desc
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
from app.services.ai_content import generate_followup_messages, generate_whatsapp_reply
from app.core.metrics import NOTIFICATION_SEND_TOTAL
from app.api.v1.ai_training import DEFAULT_CONFIG

DEFAULT_COMPANY_NAME = DEFAULT_CONFIG.get("agent_company") or "iFocusSystec"

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


async def _send_via_smtp(to: str, body: str, company_name: str | None = None) -> str:
    if not company_name:
        from app.api.v1.calls import _get_active_agent_config
        agent_config = await _get_active_agent_config()
        company_name = agent_config.get("agent_company") or DEFAULT_COMPANY_NAME

    if not settings.SMTP_HOST or not settings.SMTP_USER or not settings.SMTP_PASS:
        raise RuntimeError("SMTP credentials are not configured")

    msg = EmailMessage()
    msg["Subject"] = f"{company_name} Notification"
    msg["From"] = settings.SMTP_FROM or settings.SMTP_USER
    msg["To"] = to
    msg.set_content(body)

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
        server.starttls()
        server.login(settings.SMTP_USER, settings.SMTP_PASS)
        server.send_message(msg)
    return f"smtp-{int(datetime.now(timezone.utc).timestamp())}"


async def _dispatch_message(channel: str, to: str, body: str, company_name: str | None = None) -> tuple[str, str | None, str | None]:
    if not company_name:
        from app.api.v1.calls import _get_active_agent_config
        agent_config = await _get_active_agent_config()
        company_name = agent_config.get("agent_company") or DEFAULT_COMPANY_NAME

    if settings.MOCK_SERVICES:
        return "sent", f"mock-{int(datetime.now(timezone.utc).timestamp())}", None

    try:
        if channel in {"sms", "whatsapp"}:
            sid = _send_via_twilio(channel, to, body)
            NOTIFICATION_SEND_TOTAL.labels(channel=channel, result="sent").inc()
            return "sent", sid, None
        if channel == "email":
            sid = await _send_via_smtp(to, body, company_name)
            NOTIFICATION_SEND_TOTAL.labels(channel=channel, result="sent").inc()
            return "sent", sid, None
        NOTIFICATION_SEND_TOTAL.labels(channel=channel, result="failed").inc()
        return "failed", None, f"Unsupported channel: {channel}"
    except (TwilioRestException, RuntimeError, smtplib.SMTPException) as exc:
        NOTIFICATION_SEND_TOTAL.labels(channel=channel, result="failed").inc()
        return "failed", None, str(exc)


def _verify_internal_token(token: str | None) -> None:
    if token != settings.INTERNAL_API_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid internal token")


@router.get("/templates")
async def list_templates(current_user: User = Depends(get_current_user)):
    from app.api.v1.calls import _get_active_agent_config
    agent_config = await _get_active_agent_config()
    company_name = agent_config.get("agent_company") or DEFAULT_COMPANY_NAME
    return {
        "templates": [
            {"name": "Lead Welcome", "preview": f"Hi {{name}}, thanks for your interest in {company_name}."},
            {"name": "Screening Follow-up", "preview": f"Hi {{name}}, we reviewed your screening answers."},
            {"name": "Demo Reminder", "preview": "Your demo is confirmed for {date_time}."},
        ]
    }


@router.post("/send")
async def send_notification(
    payload: SendNotificationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.api.v1.calls import _get_active_agent_config
    agent_config = await _get_active_agent_config()
    company_name = agent_config.get("agent_company") or DEFAULT_COMPANY_NAME
    status, external_sid, error_message = await _dispatch_message(payload.channel, payload.to, payload.body, company_name)

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


@router.post("/internal/send")
async def send_notification_internal(
    payload: SendNotificationRequest,
    x_internal_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    _verify_internal_token(x_internal_token)

    from app.api.v1.calls import _get_active_agent_config
    agent_config = await _get_active_agent_config()
    company_name = agent_config.get("agent_company") or DEFAULT_COMPANY_NAME
    status, external_sid, error_message = await _dispatch_message(payload.channel, payload.to, payload.body, company_name)
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

    return {
        "status": status,
        "id": notif.id,
        "error": error_message,
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

    from app.api.v1.calls import _get_active_agent_config
    agent_config = await _get_active_agent_config()
    company_name = agent_config.get("agent_company") or DEFAULT_COMPANY_NAME

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

    sms_status, sms_sid, sms_error = await _dispatch_message("sms", lead.phone, sms_msg, company_name)
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
        email_status, email_sid, email_error = await _dispatch_message("email", lead.email, email_msg, company_name)
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


@router.get("/unread-count")
async def get_unread_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(func.count()).select_from(Notification).where(Notification.status != "read")
    count = (await db.execute(query)).scalar_one()
    return {"unread_count": count}


@router.post("/read-all")
async def mark_all_as_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(Notification).where(Notification.status != "read")
    rows = (await db.execute(query)).scalars().all()
    for row in rows:
        row.status = "read"
    await db.commit()
    return {"status": "ok", "updated_count": len(rows)}


@router.patch("/{notification_id}/read")
async def mark_as_read(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notif = (
        await db.execute(select(Notification).where(Notification.id == notification_id))
    ).scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.status = "read"
    await db.commit()
    return {"status": "ok"}


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
    inbound_text = (Body or "").strip() or "(empty inbound message)"

    lead = None
    if from_number:
        lead = (
            await db.execute(select(Lead).where(Lead.phone == from_number).limit(1))
        ).scalar_one_or_none()

    # Save inbound message
    inbound_notif = Notification(
        lead_id=lead.id if lead else None,
        channel=channel,
        recipient_phone=from_number or None,
        content=inbound_text,
        status="read",
        external_sid=MessageSid,
        sent_at=datetime.now(timezone.utc),
        delivered_at=datetime.now(timezone.utc),
    )
    db.add(inbound_notif)
    await db.flush()

    # Build conversation history for context (last 20 messages with this lead)
    history: list[dict] = []
    if lead:
        prior_rows = (
            await db.execute(
                select(Notification)
                .where(Notification.lead_id == lead.id)
                .where(Notification.channel == channel)
                .order_by(Notification.created_at.desc())
                .limit(20)
            )
        ).scalars().all()
        for row in reversed(prior_rows):
            role = "user" if row.status == "read" else "assistant"
            history.append({"role": role, "content": row.content})

    # Generate AI reply
    reply_text: str | None = None
    from app.api.v1.calls import _get_active_agent_config
    agent_config = await _get_active_agent_config()
    company_name = agent_config.get("agent_company") or DEFAULT_COMPANY_NAME

    if not settings.MOCK_SERVICES and (settings.OPENAI_API_KEY or settings.GROQ_API_KEY):
        try:
            reply_text = await generate_whatsapp_reply(
                lead_name=lead.full_name if lead else None,
                company_name=company_name,
                company_description=settings.COMPANY_DESCRIPTION or None,
                inbound_message=inbound_text,
                conversation_history=history,
            )
        except Exception as exc:
            from app.core.logger import logger
            logger.warning(f"WhatsApp AI reply generation failed: {exc}")

    if not reply_text:
        name = lead.full_name.split()[0] if lead and lead.full_name else "there"
        reply_text = (
            f"Hi {name}! Thanks for your message. Our team at {company_name} will get back to you shortly. "
            "Would you like to schedule a demo call?"
        )

    # Send the AI reply back via Twilio
    reply_status, reply_sid, reply_error = "failed", None, None
    if not settings.MOCK_SERVICES:
        try:
            to_number = from_number if not from_number.startswith("whatsapp:") else from_number
            reply_sid_raw = _send_via_twilio(channel, to_number, reply_text)
            reply_status, reply_sid = "sent", reply_sid_raw
        except Exception as exc:
            reply_error = str(exc)
            from app.core.logger import logger
            logger.warning(f"WhatsApp reply send failed from={from_number}: {exc}")
    else:
        reply_status = "sent"
        reply_sid = f"mock-reply-{int(datetime.now(timezone.utc).timestamp())}"

    reply_notif = Notification(
        lead_id=lead.id if lead else None,
        channel=channel,
        recipient_phone=from_number or None,
        content=reply_text,
        status=reply_status,
        external_sid=reply_sid,
        error_message=reply_error,
        sent_at=datetime.now(timezone.utc) if reply_status == "sent" else None,
    )
    db.add(reply_notif)
    await db.commit()

    return {
        "status": "ok",
        "lead_id": lead.id if lead else None,
        "channel": channel,
        "from": from_number,
        "to": _normalize_phone(To),
        "ai_reply_sent": reply_status == "sent",
    }
