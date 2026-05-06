from typing import Optional
from datetime import datetime, timezone
import asyncio
import os
import tempfile
from fastapi import APIRouter, Depends, Query, BackgroundTasks, HTTPException, Form
from fastapi.responses import FileResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from twilio.rest import Client as TwilioClient
from twilio.base.exceptions import TwilioRestException
from pathlib import Path
import mimetypes
import httpx

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.config import settings
from app.models.models import Call, User, Lead, Conversation, ConversationMessage
from app.schemas.schemas import PaginatedResponse, CallOut, OutboundCallRequest
from app.services.ai_content import generate_call_opening

router = APIRouter()

HANGUP_THRESHOLD_SECONDS = 5


def _normalize_call_status(provider_status: str | None, duration_seconds: int | None = None) -> str:
    raw = (provider_status or "").strip().lower()
    duration = max(int(duration_seconds or 0), 0)

    if raw in {"no-answer", "no_answer", "busy", "failed", "canceled", "cancelled"}:
        return "no_response"

    if raw == "completed":
        if duration_seconds is None:
            return "answered"
        if duration <= 0:
            return "hangup"
        if duration <= HANGUP_THRESHOLD_SECONDS:
            return "hangup"
        return "answered"

    mapping = {
        "queued": "initiated",
        "initiated": "initiated",
        "ringing": "ringing",
        "answered": "answered",
        "in-progress": "in_progress",
        "in_progress": "in_progress",
    }
    return mapping.get(raw, "initiated")


def _normalize_twilio_direction(direction: str | None, from_number: str | None, to_number: str | None) -> str:
    raw = (direction or "").strip().lower()
    if raw.startswith("inbound"):
        return "inbound"
    if raw.startswith("outbound"):
        return "outbound"

    twilio_number = (settings.TWILIO_PHONE_NUMBER or "").strip()
    if twilio_number:
        if (from_number or "").strip() == twilio_number:
            return "outbound"
        if (to_number or "").strip() == twilio_number:
            return "inbound"
    return "outbound"


def _resolve_twilio_call_numbers(direction: str, from_number: str | None, to_number: str | None) -> tuple[str | None, str | None]:
    frm = (from_number or "").strip() or None
    to = (to_number or "").strip() or None
    twilio_number = (settings.TWILIO_PHONE_NUMBER or "").strip() or None

    if direction == "outbound":
        if frm is None:
            frm = twilio_number
    elif direction == "inbound":
        if to is None:
            to = twilio_number

    return frm, to


def _ensure_aware_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


async def _resolve_lead_id_by_phone(db: AsyncSession, phone: str | None) -> str | None:
    target = (phone or "").strip()
    if not target:
        return None
    return (
        await db.execute(
            select(Lead.id)
            .where(Lead.phone == target)
            .limit(1)
        )
    ).scalar_one_or_none()


async def _import_recent_twilio_calls(db: AsyncSession, client: TwilioClient, limit: int = 100) -> int:
    if limit <= 0:
        return 0

    try:
        twilio_calls = client.calls.list(limit=limit)
    except Exception:
        return 0

    if not twilio_calls:
        return 0

    sid_list = [getattr(item, "sid", None) for item in twilio_calls if getattr(item, "sid", None)]
    if not sid_list:
        return 0

    existing_sids = set(
        (
            await db.execute(
                select(Call.twilio_call_sid).where(Call.twilio_call_sid.in_(sid_list))
            )
        ).scalars().all()
    )

    created = 0
    for tw_call in twilio_calls:
        sid = getattr(tw_call, "sid", None)
        if not sid or sid in existing_sids:
            continue

        raw_from = getattr(tw_call, "from_", None)
        raw_to = getattr(tw_call, "to", None)
        direction = _normalize_twilio_direction(getattr(tw_call, "direction", None), raw_from, raw_to)
        from_number, to_number = _resolve_twilio_call_numbers(direction, raw_from, raw_to)
        if not from_number or not to_number:
            continue

        tw_duration = _to_int(getattr(tw_call, "duration", None))
        lead_phone = to_number if direction == "outbound" else from_number
        lead_id = await _resolve_lead_id_by_phone(db, lead_phone)

        db.add(
            Call(
                twilio_call_sid=sid,
                lead_id=lead_id,
                direction=direction,
                status=_normalize_call_status(getattr(tw_call, "status", None), tw_duration),
                from_number=from_number,
                to_number=to_number,
                duration_seconds=max(tw_duration or 0, 0),
                started_at=_ensure_aware_datetime(getattr(tw_call, "start_time", None)),
                ended_at=_ensure_aware_datetime(getattr(tw_call, "end_time", None)),
                created_at=_ensure_aware_datetime(getattr(tw_call, "date_created", None)) or datetime.now(timezone.utc),
                handled_by="ai",
                metadata_={
                    "provider": "twilio",
                    "imported_from_twilio": True,
                    "twilio_direction": getattr(tw_call, "direction", None),
                    "twilio_status": getattr(tw_call, "status", None),
                },
            )
        )
        existing_sids.add(sid)
        created += 1

    if created:
        await db.commit()
    return created


def _webhook_base_url() -> str:
    base = (settings.TWILIO_WEBHOOK_URL or "").strip().rstrip("/")
    if base:
        return base
    return f"http://localhost:{settings.PORT}"


def _normalize_recording_url(recording_url: str | None) -> str | None:
    if not recording_url:
        return None
    url = recording_url.strip()
    if not url:
        return None
    if url.endswith(".mp3") or url.endswith(".wav"):
        return url
    return url


def _recording_url_candidates(recording_url: str) -> list[str]:
    base = recording_url.strip()
    if not base:
        return []

    candidates: list[str] = [base]
    lower = base.lower()

    if lower.endswith(".mp3"):
        candidates.append(base[:-4] + ".wav")
    elif lower.endswith(".wav"):
        candidates.append(base[:-4] + ".mp3")
    else:
        candidates.append(base + ".mp3")
        candidates.append(base + ".wav")

    # Preserve order, deduplicate.
    return list(dict.fromkeys(candidates))


async def _ensure_conversation_for_call(db: AsyncSession, call: Call) -> Conversation:
    conversation = (
        await db.execute(
            select(Conversation)
            .where(Conversation.call_id == call.id)
            .order_by(Conversation.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if conversation:
        return conversation

    conversation = Conversation(
        call_id=call.id,
        lead_id=call.lead_id,
        session_id=f"call-{call.id}",
        primary_intent="call_review",
    )
    db.add(conversation)
    await db.flush()
    return conversation


async def _transcribe_remote_recording(recording_url: str | None) -> str | None:
    if settings.MOCK_SERVICES or not settings.ASSEMBLYAI_API_KEY:
        return None
    if not recording_url or not recording_url.startswith(("http://", "https://")):
        return None
    if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN:
        return None

    try:
        text, _ = await _transcribe_remote_recording_with_error(recording_url)
        return text
    except Exception:
        return None


async def _transcribe_with_assemblyai(audio_bytes: bytes) -> tuple[str | None, str | None]:
    if not settings.ASSEMBLYAI_API_KEY:
        return None, "AssemblyAI API key is not configured for transcription"
    if not audio_bytes:
        return None, "Recording audio is empty"

    base_url = settings.ASSEMBLYAI_API_BASE_URL.rstrip("/")
    headers = {"authorization": settings.ASSEMBLYAI_API_KEY}

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            upload_resp = await client.post(
                f"{base_url}/upload",
                headers={**headers, "content-type": "application/octet-stream"},
                content=audio_bytes,
            )
            upload_resp.raise_for_status()
            upload_url = upload_resp.json().get("upload_url")
            if not upload_url:
                return None, "AssemblyAI upload did not return an upload_url"

            transcript_resp = await client.post(
                f"{base_url}/transcript",
                headers={**headers, "content-type": "application/json"},
                json={
                    "audio_url": upload_url,
                    "speech_models": [settings.ASSEMBLYAI_SPEECH_MODEL],
                    "punctuate": True,
                    "format_text": True,
                },
            )
            transcript_resp.raise_for_status()
            transcript_id = transcript_resp.json().get("id")
            if not transcript_id:
                return None, "AssemblyAI transcript request did not return an id"

            deadline = asyncio.get_running_loop().time() + settings.ASSEMBLYAI_TRANSCRIPT_TIMEOUT_SECONDS
            while asyncio.get_running_loop().time() < deadline:
                poll_resp = await client.get(
                    f"{base_url}/transcript/{transcript_id}",
                    headers=headers,
                )
                poll_resp.raise_for_status()
                payload = poll_resp.json()
                status = (payload.get("status") or "").lower()

                if status == "completed":
                    text = (payload.get("text") or "").strip()
                    if text:
                        return text, None
                    return None, "AssemblyAI completed transcription without text"

                if status == "error":
                    return None, payload.get("error") or "AssemblyAI transcription failed"

                await asyncio.sleep(settings.ASSEMBLYAI_POLL_INTERVAL_SECONDS)

            return None, "AssemblyAI transcription timed out"
        except Exception as exc:
            return None, str(exc)


async def _transcribe_remote_recording_with_error(recording_url: str | None) -> tuple[str | None, str | None]:
    if settings.MOCK_SERVICES:
        return None, "Transcription is unavailable while mock mode is enabled"
    if not settings.ASSEMBLYAI_API_KEY:
        return None, "AssemblyAI API key is not configured for transcription"
    if not recording_url or not recording_url.startswith(("http://", "https://")):
        return None, "Recording URL is unavailable for transcription"
    if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN:
        return None, "Twilio credentials are required to read call audio"

    try:
        audio_bytes, _ = await _fetch_external_recording_bytes(recording_url)
        return await _transcribe_with_assemblyai(audio_bytes)
    except Exception as exc:
        return None, str(exc)


def _to_int(value: object | None) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if text.isdigit():
        return int(text)
    return None


def _is_placeholder_recording_url(url: str | None) -> bool:
    if not url:
        return False
    return "/Accounts/AC/Recordings/" in url


def _is_answered_status(status: str | None) -> bool:
    return (status or "").strip().lower() in {"answered", "completed"}


async def _ensure_call_recording_available(db: AsyncSession, call: Call) -> bool:
    if call.recording_url and not _is_placeholder_recording_url(call.recording_url):
        return True

    refreshed = await _refresh_recording_url_from_twilio(db, call)
    if refreshed and call.recording_url:
        return True

    if call.recording_url:
        call.recording_url = None
        await db.commit()
    return False


async def _ensure_call_transcript_available(db: AsyncSession, call: Call) -> bool:
    transcript_exists = (
        await db.execute(
            select(func.count())
            .select_from(ConversationMessage)
            .join(Conversation, ConversationMessage.conversation_id == Conversation.id)
            .where(Conversation.call_id == call.id)
            .where(ConversationMessage.intent == "call_transcript")
        )
    ).scalar_one() > 0
    if transcript_exists:
        return True

    if not _is_answered_status(call.status):
        return False

    has_recording = await _ensure_call_recording_available(db, call)
    if not has_recording:
        return False

    text, transcript_error = await _transcribe_remote_recording_with_error(call.recording_url)
    if not text:
        metadata = dict(call.metadata_ or {})
        metadata["transcript_available"] = False
        if transcript_error:
            metadata["transcript_error"] = transcript_error
            metadata["transcript_last_attempt_at"] = datetime.now(timezone.utc).isoformat()
            call.metadata_ = metadata
            await db.commit()
        return False

    conversation = await _ensure_conversation_for_call(db, call)
    db.add(
        ConversationMessage(
            conversation_id=conversation.id,
            role="user",
            content=text,
            intent="call_transcript",
        )
    )
    if not conversation.summary:
        conversation.summary = text[:500]

    metadata = dict(call.metadata_ or {})
    metadata["transcript_available"] = True
    metadata["transcript_generated_at"] = datetime.now(timezone.utc).isoformat()
    metadata.pop("transcript_error", None)
    call.metadata_ = metadata
    await db.commit()
    return True


async def _get_call_transcript_text(db: AsyncSession, call_id: str) -> str | None:
    messages = (
        await db.execute(
            select(ConversationMessage.content)
            .join(Conversation, ConversationMessage.conversation_id == Conversation.id)
            .where(Conversation.call_id == call_id)
            .where(ConversationMessage.intent == "call_transcript")
            .order_by(ConversationMessage.created_at.desc())
            .limit(1)
        )
    ).scalars().all()

    for content in messages:
        text = (content or "").strip()
        if text:
            return text
    return None


async def _sync_call_from_twilio(
    db: AsyncSession,
    call: Call,
    client: TwilioClient,
    *,
    force_transcribe: bool = False,
) -> bool:
    if not call.twilio_call_sid:
        return False

    try:
        tw_call = client.calls(call.twilio_call_sid).fetch()
    except Exception:
        return False

    changed = False
    tw_duration = _to_int(getattr(tw_call, "duration", None))
    normalized_status = _normalize_call_status(getattr(tw_call, "status", None), tw_duration)

    if normalized_status and call.status != normalized_status:
        call.status = normalized_status
        changed = True

    if tw_duration is not None and call.duration_seconds != tw_duration:
        call.duration_seconds = tw_duration
        changed = True

    tw_start = getattr(tw_call, "start_time", None)
    tw_end = getattr(tw_call, "end_time", None)
    if tw_start and not call.started_at:
        call.started_at = tw_start
        changed = True
    if tw_end and call.ended_at != tw_end:
        call.ended_at = tw_end
        changed = True

    transcript_exists = (
        await db.execute(select(func.count()).select_from(Conversation).where(Conversation.call_id == call.id))
    ).scalar_one() > 0

    should_fetch_recording = (not call.recording_url) or force_transcribe or _is_placeholder_recording_url(call.recording_url)
    if should_fetch_recording:
        try:
            recordings = client.recordings.list(call_sid=call.twilio_call_sid, limit=1)
        except Exception:
            recordings = []

        if recordings:
            rec = recordings[0]
            rec_uri = getattr(rec, "uri", None) or ""
            rec_url = f"https://api.twilio.com{rec_uri.replace('.json', '.mp3')}" if rec_uri else None
            rec_sid = getattr(rec, "sid", None)
            rec_duration = _to_int(getattr(rec, "duration", None))

            if rec_url and call.recording_url != rec_url:
                call.recording_url = rec_url
                changed = True
            if rec_sid and call.recording_sid != rec_sid:
                call.recording_sid = rec_sid
                changed = True
            if rec_duration is not None and call.duration_seconds != rec_duration:
                call.duration_seconds = rec_duration
                changed = True

    if (force_transcribe or not transcript_exists) and call.recording_url:
        text = await _transcribe_remote_recording(call.recording_url)
        if text:
            conversation = await _ensure_conversation_for_call(db, call)
            db.add(
                ConversationMessage(
                    conversation_id=conversation.id,
                    role="user",
                    content=text,
                    intent="call_transcript",
                )
            )
            if not conversation.summary:
                conversation.summary = text[:500]
            changed = True

    if changed:
        metadata = dict(call.metadata_ or {})
        metadata["last_synced_from_twilio_at"] = datetime.now(timezone.utc).isoformat()
        call.metadata_ = metadata

    return changed


def _resolve_recording_path(recording_url: str) -> Path:
    if recording_url.startswith("http://") or recording_url.startswith("https://"):
        raise HTTPException(status_code=400, detail="Recording is stored externally and cannot be streamed locally.")

    candidate = Path(recording_url)
    if not candidate.is_absolute():
        candidate = Path.cwd() / candidate

    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=404, detail="Recording file not found")

    return candidate


async def _fetch_external_recording_bytes(recording_url: str) -> tuple[bytes, str]:
    if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN:
        raise HTTPException(status_code=500, detail="Twilio credentials are required to fetch external recordings")

    errors: list[str] = []
    async with httpx.AsyncClient(
        auth=(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN),
        timeout=60.0,
    ) as client:
        for url in _recording_url_candidates(recording_url):
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                media_type = resp.headers.get("content-type") or "audio/mpeg"
                return resp.content, media_type
            except Exception as exc:
                errors.append(f"{url}: {exc}")

    raise HTTPException(status_code=502, detail=f"Failed to fetch external recording: {' | '.join(errors)}")


async def _refresh_recording_url_from_twilio(db: AsyncSession, call: Call) -> bool:
    if not call.twilio_call_sid:
        return False
    if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN:
        return False

    client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    recording = None

    if call.recording_sid:
        try:
            recording = client.recordings(call.recording_sid).fetch()
        except Exception:
            recording = None

    if recording is None:
        try:
            rows = client.recordings.list(call_sid=call.twilio_call_sid, limit=1)
            if rows:
                recording = rows[0]
        except Exception:
            recording = None

    if recording is None:
        return False

    rec_uri = getattr(recording, "uri", None) or ""
    rec_sid = getattr(recording, "sid", None)
    if not rec_uri:
        return False

    fresh_url = f"https://api.twilio.com{rec_uri.replace('.json', '.mp3')}"
    changed = False
    if call.recording_url != fresh_url:
        call.recording_url = fresh_url
        changed = True
    if rec_sid and call.recording_sid != rec_sid:
        call.recording_sid = rec_sid
        changed = True

    if changed:
        await db.commit()
    return True

@router.get("", response_model=PaginatedResponse)
@router.get("/", response_model=PaginatedResponse)
async def list_calls(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=1000),
    status: Optional[str] = Query(None),
    direction: Optional[str] = Query(None),
    lead_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List call history with filtering and pagination."""
    twilio_live_mode = bool(
        (not settings.MOCK_SERVICES)
        and settings.TWILIO_ACCOUNT_SID
        and settings.TWILIO_AUTH_TOKEN
    )

    if twilio_live_mode:
        client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        # Pull missing calls from Twilio so UI history includes all triggered calls.
        await _import_recent_twilio_calls(db, client, limit=200)

    query = select(Call)

    # In Twilio live mode, show only Twilio-backed calls to avoid stale local/mock rows.
    if twilio_live_mode:
        query = query.where(Call.twilio_call_sid.is_not(None))

    if status:
        query = query.where(Call.status == status)
    if direction:
        query = query.where(Call.direction == direction)
    if lead_id:
        query = query.where(Call.lead_id == lead_id)

    # Count total
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar_one()

    # Paginate
    offset = (page - 1) * page_size
    query = query.order_by(Call.created_at.desc()).offset(offset).limit(page_size)
    result = await db.execute(query)
    calls = result.scalars().all()

    # Keep DB history fresh even if Twilio webhook delivery is delayed/missed.
    if twilio_live_mode:
        client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        changed = False
        for call in calls:
            if not call.twilio_call_sid:
                continue

            # Always sync rows visible in UI so duration/status/recording stay aligned with Twilio logs.
            changed = (await _sync_call_from_twilio(db, call, client)) or changed

            if _is_answered_status(call.status) and (
                not call.recording_url
                or _is_placeholder_recording_url(call.recording_url)
            ):
                refreshed = await _refresh_recording_url_from_twilio(db, call)
                changed = refreshed or changed
        if changed:
            await db.commit()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [CallOut.model_validate(c, from_attributes=True) for c in calls],
    }

async def delayed_call_trigger(lead_id: str, to_number: str, delay_seconds: float):
    if delay_seconds > 0:
        await asyncio.sleep(delay_seconds)
    
    import httpx
    async with httpx.AsyncClient() as client:
        try:
            await client.post(f"http://localhost:{settings.PORT}/calls/outbound", json={
                "lead_id": lead_id,
                "to_number": to_number,
            }, timeout=5.0)
        except Exception as e:
            print(f"Scheduled call failed: {e}")

@router.post("/scheduled")
async def schedule_call(
    lead_id: str,
    to_number: str,
    scheduled_at: datetime,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    """Schedules a call to be made at a specific time."""
    now = datetime.now(timezone.utc)
    # Ensure scheduled_at is timezone-aware
    if scheduled_at.tzinfo is None:
        scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
        
    delay = (scheduled_at - now).total_seconds()
    
    if delay < 0:
        raise HTTPException(status_code=400, detail="Scheduled time must be in the future.")
    
    background_tasks.add_task(delayed_call_trigger, lead_id, to_number, delay)
    return {"status": "scheduled", "delay_seconds": delay, "scheduled_at": scheduled_at}


@router.post("/outbound")
async def outbound_call(
    payload: OutboundCallRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = (await db.execute(select(Lead).where(Lead.id == payload.lead_id))).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    to_number = payload.to_number or lead.phone
    ai_script = payload.message or await generate_call_opening(
        full_name=lead.full_name,
        interest=lead.interest,
        job_role=lead.job_role,
        years_experience=lead.years_experience,
    )

    twilio_sid = None
    provider_status = "initiated"
    provider = "mock"

    if not settings.MOCK_SERVICES:
        if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN or not settings.TWILIO_PHONE_NUMBER:
            raise HTTPException(status_code=500, detail="Twilio credentials are not configured.")

        try:
            client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
            base_url = _webhook_base_url()
            twilio_call = client.calls.create(
                to=to_number,
                from_=settings.TWILIO_PHONE_NUMBER,
                twiml=f"<Response><Say voice='alice'>{ai_script}</Say></Response>",
                record=True,
                status_callback=f"{base_url}/calls/webhooks/twilio/status",
                status_callback_event=["initiated", "ringing", "answered", "completed"],
                status_callback_method="POST",
                recording_status_callback=f"{base_url}/calls/webhooks/twilio/recording",
                recording_status_callback_method="POST",
            )
            twilio_sid = twilio_call.sid
            provider_status = _normalize_call_status(twilio_call.status, 0)
            provider = "twilio"
        except TwilioRestException as exc:
            raise HTTPException(status_code=502, detail=f"Twilio call failed: {exc.msg}")

    if settings.MOCK_SERVICES:
        provider_status = "answered"

    call = Call(
        lead_id=lead.id,
        direction="outbound",
        status=provider_status,
        twilio_call_sid=twilio_sid,
        from_number=settings.TWILIO_PHONE_NUMBER or "+10000000000",
        to_number=to_number,
        duration_seconds=0,
        handled_by="ai",
        metadata_={"ai_script": ai_script, "source": "crm_outbound", "provider": provider},
        started_at=datetime.now(timezone.utc),
    )
    db.add(call)

    if lead.status == "new":
        lead.status = "contacted"

    await db.commit()
    await db.refresh(call)

    return {
        "call_id": call.id,
        "lead_id": lead.id,
        "status": call.status,
        "provider": provider,
        "twilio_call_sid": twilio_sid,
        "ai_script": ai_script,
        "to_number": to_number,
    }


@router.post("/webhooks/twilio/status")
async def twilio_call_status_webhook(
    CallSid: str = Form(...),
    CallStatus: str = Form(...),
    CallDuration: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    call = (await db.execute(select(Call).where(Call.twilio_call_sid == CallSid))).scalar_one_or_none()
    if not call:
        return {"status": "ignored", "reason": "call_not_found", "twilio_call_sid": CallSid}

    duration_seconds = int(CallDuration) if (CallDuration and str(CallDuration).isdigit()) else None
    call.status = _normalize_call_status(CallStatus, duration_seconds)
    if CallDuration and str(CallDuration).isdigit():
        call.duration_seconds = int(CallDuration)
    if call.status in {"answered", "hangup", "no_response"} and not call.ended_at:
        call.ended_at = datetime.now(timezone.utc)

    metadata = dict(call.metadata_ or {})
    metadata["last_twilio_status"] = CallStatus
    call.metadata_ = metadata

    await db.commit()
    return {"status": "ok", "call_id": call.id, "normalized_status": call.status}


@router.post("/webhooks/twilio/recording")
async def twilio_recording_webhook(
    CallSid: str = Form(...),
    RecordingSid: Optional[str] = Form(None),
    RecordingUrl: Optional[str] = Form(None),
    RecordingDuration: Optional[str] = Form(None),
    TranscriptionText: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    call = (await db.execute(select(Call).where(Call.twilio_call_sid == CallSid))).scalar_one_or_none()
    if not call:
        return {"status": "ignored", "reason": "call_not_found", "twilio_call_sid": CallSid}

    normalized_url = _normalize_recording_url(RecordingUrl)
    if normalized_url:
        call.recording_url = normalized_url
    if RecordingSid:
        call.recording_sid = RecordingSid
    if RecordingDuration and str(RecordingDuration).isdigit():
        call.duration_seconds = int(RecordingDuration)

    transcript_text = (TranscriptionText or "").strip() or await _transcribe_remote_recording(call.recording_url)
    if transcript_text:
        conversation = await _ensure_conversation_for_call(db, call)
        db.add(
            ConversationMessage(
                conversation_id=conversation.id,
                role="user",
                content=transcript_text,
                intent="call_transcript",
            )
        )
        if not conversation.summary:
            conversation.summary = transcript_text[:500]

    if call.status not in {"answered", "hangup", "no_response"}:
        call.status = _normalize_call_status("completed", call.duration_seconds)
    if not call.ended_at:
        call.ended_at = datetime.now(timezone.utc)

    metadata = dict(call.metadata_ or {})
    metadata["transcript_available"] = bool(transcript_text)
    metadata["recording_webhook_received_at"] = datetime.now(timezone.utc).isoformat()
    call.metadata_ = metadata

    await db.commit()
    return {
        "status": "ok",
        "call_id": call.id,
        "recording_url": call.recording_url,
        "transcript_available": bool(transcript_text),
    }


@router.post("/backfill-recordings")
async def backfill_twilio_recordings(
    force_transcribe: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if settings.MOCK_SERVICES:
        raise HTTPException(status_code=400, detail="Backfill is unavailable in mock mode")
    if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN:
        raise HTTPException(status_code=500, detail="Twilio credentials are not configured")

    client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    rows = (
        await db.execute(
            select(Call)
            .where(Call.twilio_call_sid.is_not(None))
            .order_by(Call.created_at.desc())
        )
    ).scalars().all()

    updated = 0
    transcripts = 0
    for call in rows:
        should_update_recording = force_transcribe or not call.recording_url
        transcript_exists = (
            await db.execute(
                select(func.count()).select_from(Conversation).where(Conversation.call_id == call.id)
            )
        ).scalar_one() > 0

        if not should_update_recording and transcript_exists and not force_transcribe:
            continue

        try:
            recordings = client.recordings.list(call_sid=call.twilio_call_sid, limit=1)
        except Exception:
            continue
        if not recordings:
            continue

        rec = recordings[0]
        api_uri = rec.uri or ""
        recording_url = None
        if api_uri:
            recording_url = f"https://api.twilio.com{api_uri.replace('.json', '.mp3')}"
        if recording_url:
            call.recording_url = recording_url
            updated += 1

        text = await _transcribe_remote_recording(call.recording_url) if (force_transcribe or not transcript_exists) else None
        if text:
            conversation = await _ensure_conversation_for_call(db, call)
            db.add(
                ConversationMessage(
                    conversation_id=conversation.id,
                    role="user",
                    content=text,
                    intent="call_transcript",
                )
            )
            if not conversation.summary:
                conversation.summary = text[:500]
            transcripts += 1

    await db.commit()
    return {
        "status": "ok",
        "calls_scanned": len(rows),
        "recordings_updated": updated,
        "transcripts_added": transcripts,
    }


@router.post("/sync-history")
async def sync_call_history(
    only_open_calls: bool = True,
    force_transcribe: bool = False,
    max_calls: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if settings.MOCK_SERVICES:
        raise HTTPException(status_code=400, detail="Sync is unavailable in mock mode")
    if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN:
        raise HTTPException(status_code=500, detail="Twilio credentials are not configured")

    base_query = select(Call).where(Call.twilio_call_sid.is_not(None)).order_by(Call.created_at.desc())
    if only_open_calls:
        base_query = base_query.where(Call.status.in_(["initiated", "ringing", "in_progress"]))

    rows = (await db.execute(base_query.limit(max_calls))).scalars().all()
    client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)

    updated = 0
    for call in rows:
        if await _sync_call_from_twilio(db, call, client, force_transcribe=force_transcribe):
            updated += 1

    await db.commit()
    return {
        "status": "ok",
        "calls_scanned": len(rows),
        "calls_updated": updated,
        "only_open_calls": only_open_calls,
    }


@router.get("/{call_id}/monitor")
async def monitor_call(
    call_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    call = (await db.execute(select(Call).where(Call.id == call_id))).scalar_one_or_none()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    conversation = (
        await db.execute(
            select(Conversation)
            .where(Conversation.call_id == call.id)
            .order_by(Conversation.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    messages = []
    if conversation:
        messages = (
            await db.execute(
                select(ConversationMessage)
                .where(ConversationMessage.conversation_id == conversation.id)
                .order_by(ConversationMessage.created_at.asc())
            )
        ).scalars().all()

    return {
        "call": {
            "id": call.id,
            "lead_id": call.lead_id,
            "direction": call.direction,
            "status": call.status,
            "duration_seconds": call.duration_seconds,
            "recording_url": call.recording_url,
            "metadata": call.metadata_,
            "created_at": call.created_at,
        },
        "conversation": {
            "id": conversation.id if conversation else None,
            "summary": conversation.summary if conversation else None,
            "messages": [
                {
                    "role": m.role,
                    "content": m.content,
                    "intent": m.intent,
                    "created_at": m.created_at,
                }
                for m in messages
            ],
        },
    }


@router.get("/{call_id}/transcript")
async def call_transcript(
    call_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    call = (await db.execute(select(Call).where(Call.id == call_id))).scalar_one_or_none()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    if _is_answered_status(call.status):
        await _ensure_call_transcript_available(db, call)

    transcript_text = await _get_call_transcript_text(db, call.id)
    if not transcript_text:
        transcript_error = (call.metadata_ or {}).get("transcript_error")
        if transcript_error:
            raise HTTPException(status_code=503, detail=f"Transcript generation failed: {transcript_error}")

    conversation = (
        await db.execute(
            select(Conversation)
            .where(Conversation.call_id == call.id)
            .order_by(Conversation.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if not conversation:
        return {"call_id": call.id, "summary": None, "transcript": transcript_text, "qa": []}

    messages = (
        await db.execute(
            select(ConversationMessage)
            .where(ConversationMessage.conversation_id == conversation.id)
            .order_by(ConversationMessage.created_at.asc())
        )
    ).scalars().all()

    qa = []
    pending_question = None
    for message in messages:
        if message.role == "assistant":
            pending_question = message.content
        elif message.role == "user":
            qa.append(
                {
                    "question": pending_question,
                    "answer": message.content,
                    "asked_at": message.created_at,
                }
            )
            pending_question = None

    return {
        "call_id": call.id,
        "summary": conversation.summary,
        "transcript": transcript_text,
        "qa": qa,
    }


@router.get("/{call_id}/recording")
async def stream_recording(
    call_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    call = (await db.execute(select(Call).where(Call.id == call_id))).scalar_one_or_none()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    if not call.recording_url and _is_answered_status(call.status):
        await _ensure_call_recording_available(db, call)

    if not call.recording_url:
        raise HTTPException(status_code=404, detail="No recording available for this call")

    if call.recording_url.startswith(("http://", "https://")):
        try:
            data, media_type = await _fetch_external_recording_bytes(call.recording_url)
        except HTTPException as exc:
            refreshed = False
            if exc.status_code == 502 and "404" in str(exc.detail):
                refreshed = await _refresh_recording_url_from_twilio(db, call)
            if not refreshed:
                if exc.status_code == 502 and "404" in str(exc.detail):
                    call.recording_url = None
                    await db.commit()
                    raise HTTPException(status_code=404, detail="No recording available for this call") from exc
                raise
            data, media_type = await _fetch_external_recording_bytes(call.recording_url)
        return Response(content=data, media_type=media_type)

    path = _resolve_recording_path(call.recording_url)
    media_type, _ = mimetypes.guess_type(str(path))
    return FileResponse(path=str(path), media_type=media_type or "application/octet-stream", filename=path.name)


@router.get("/{call_id}/recording/download")
async def download_recording(
    call_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    call = (await db.execute(select(Call).where(Call.id == call_id))).scalar_one_or_none()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    if not call.recording_url and _is_answered_status(call.status):
        await _ensure_call_recording_available(db, call)

    if not call.recording_url:
        raise HTTPException(status_code=404, detail="No recording available for this call")

    if call.recording_url.startswith(("http://", "https://")):
        try:
            data, media_type = await _fetch_external_recording_bytes(call.recording_url)
        except HTTPException as exc:
            refreshed = False
            if exc.status_code == 502 and "404" in str(exc.detail):
                refreshed = await _refresh_recording_url_from_twilio(db, call)
            if not refreshed:
                if exc.status_code == 502 and "404" in str(exc.detail):
                    call.recording_url = None
                    await db.commit()
                    raise HTTPException(status_code=404, detail="No recording available for this call") from exc
                raise
            data, media_type = await _fetch_external_recording_bytes(call.recording_url)
        return Response(
            content=data,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename=call-{call.id}.mp3"},
        )

    path = _resolve_recording_path(call.recording_url)
    media_type, _ = mimetypes.guess_type(str(path))
    return FileResponse(
        path=str(path),
        media_type=media_type or "application/octet-stream",
        filename=path.name,
        content_disposition_type="attachment",
    )
