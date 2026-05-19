from typing import Optional
from datetime import datetime, timezone
import asyncio
import base64
import contextlib
import os
import ssl
import tempfile
import audioop
import json
import certifi
from fastapi import APIRouter, Depends, Query, BackgroundTasks, HTTPException, Form, Header, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from twilio.rest import Client as TwilioClient
from twilio.base.exceptions import TwilioRestException
from twilio.twiml.voice_response import VoiceResponse, Gather
from pathlib import Path
import mimetypes
import httpx
import websockets

from app.core.database import get_db
from app.core.logger import logger
from app.core.security import get_current_user
from app.core.config import settings
from app.core.metrics import OUTBOUND_CALLS_TOTAL, CALL_STATUS_WEBHOOK_TOTAL
from app.models.models import Call, User, Lead, Conversation, ConversationMessage
from app.schemas.schemas import PaginatedResponse, CallOut, OutboundCallRequest
from app.services.ai_content import generate_sales_call_turn, generate_sales_cross_questions, generate_dynamic_next_question
from app.services.lead_scoring import update_lead_score, score_delta_from_call_status
from app.services.ai_memory import upsert_conversation_memory
from app.workers.tasks import trigger_outbound_call, schedule_retry_chain, transcribe_call_recording

router = APIRouter()

HANGUP_THRESHOLD_SECONDS = 5
COMPANY_NAME = "Walkin Software"
AI_CALLER_NAME = "Siri"
MAX_NO_INPUT_RETRIES = 2
MAX_CLARIFICATION_RETRIES_PER_QUESTION = 2
MAX_TOTAL_CLARIFICATION_RETRIES = 4
MAX_CROSS_QUESTIONS_PER_ANSWER = 0


def _verify_internal_token(token: str | None) -> None:
    if token != settings.INTERNAL_API_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid internal token")


def _queue_retry_for_call(call: Call) -> None:
    metadata = dict(call.metadata_ or {})
    retry_attempt = int(metadata.get("retry_attempt", 0))
    if call.direction != "outbound" or not call.lead_id:
        return
    if metadata.get("retry_closed"):
        return

    # Avoid duplicate retry enqueue when provider sends repeated terminal status updates.
    retry_marker = f"{call.status}:{retry_attempt}"
    if metadata.get("retry_last_marker") == retry_marker:
        return

    try:
        schedule_retry_chain.delay(call.lead_id, call.to_number, retry_attempt)
    except Exception as exc:
        logger.warning(f"Retry enqueue failed for call={call.id}: {exc}")
        return
    metadata["retry_attempt"] = retry_attempt + 1
    metadata["retry_last_queued_at"] = datetime.now(timezone.utc).isoformat()
    metadata["retry_last_marker"] = retry_marker
    call.metadata_ = metadata


def _twilio_http_auth() -> tuple[str, str] | None:
    if settings.TWILIO_API_KEY and settings.TWILIO_API_SECRET:
        return settings.TWILIO_API_KEY, settings.TWILIO_API_SECRET
    if settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN:
        return settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN
    return None


def _twilio_client() -> TwilioClient:
    if settings.TWILIO_API_KEY and settings.TWILIO_API_SECRET and settings.TWILIO_ACCOUNT_SID:
        return TwilioClient(settings.TWILIO_API_KEY, settings.TWILIO_API_SECRET, settings.TWILIO_ACCOUNT_SID)
    return TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)


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


def _public_base_url() -> str:
    base = (settings.TWILIO_WEBHOOK_URL or "").strip().rstrip("/")
    if base.endswith("/webhooks/twilio"):
        return base[: -len("/webhooks/twilio")]
    if base:
        return base
    return f"http://localhost:{settings.PORT}"


def _public_wss_base_url() -> str:
    base = _public_base_url()
    if base.startswith("https://"):
        return "wss://" + base[len("https://"):]
    if base.startswith("http://"):
        return "ws://" + base[len("http://"):]
    return base


def _lead_interest_label(lead: Lead) -> str:
    return (lead.interest or lead.job_role or "the role you applied for").strip()


async def _build_sales_call_questions(lead: Lead) -> list[str]:
    interest_label = _lead_interest_label(lead)

    if "demo" in interest_label.lower():
        first_question = "Are you interested in proceeding so we can book a demo for you?"
    else:
        first_question = "Are you interested in proceeding with this opportunity?"

    # Keep only the opening question static.
    # Remaining turns are AI-generated from interest + description + responses.
    questions = [
        first_question,
        "What would you like to know first about this opportunity?",
        "What date and time would be convenient for a short discussion with our team?",
        "What specific outcome are you expecting from this discussion?",
    ]

    return [question.strip() for question in questions[:3] if question and question.strip()]


def _initial_sales_prompt(lead: Lead, first_question: str, intro_override: str | None = None) -> str:
    interest_label = _lead_interest_label(lead)
    intro = intro_override or f"Hello {lead.full_name}, this is {AI_CALLER_NAME} from {COMPANY_NAME}."
    return f"{intro} We are calling regarding your interest in {interest_label}. {first_question}"


def _fallback_sales_questions(interest_label: str) -> list[str]:
    if "demo" in interest_label.lower():
        return [
            "Are you interested in proceeding so we can book a demo for you?",
            "What would you like to know first about this opportunity?",
            "What date and time would be convenient for a short discussion with our team?",
        ]
    return [
        "Are you interested in proceeding with this opportunity?",
        "What would you like to know first about this opportunity?",
        "What date and time would be convenient for a short discussion with our team?",
    ]


def _sales_followup_prompt(next_question: str) -> str:
    return f"Thank you for sharing that. {next_question}"


def _sales_closing_prompt() -> str:
    return f"Thank you for your time today. Our team at {COMPANY_NAME} will review your responses and contact you shortly. Have a great day."


def _sales_clarification_limit_prompt() -> str:
    return (
        f"Thank you for your questions. Our {COMPANY_NAME} team will get back to you with full details "
        "about the demo, course, and pricing. Have a great day."
    )


def _active_sales_question(state: dict, questions: list[str], current_index: int) -> str:
    pending_cross_questions = list(state.get("pending_cross_questions") or [])
    if pending_cross_questions:
        return pending_cross_questions[0]
    if not questions:
        return "Could you please continue?"
    return questions[max(0, min(current_index, len(questions) - 1))]


def _ensure_not_repeated_question(candidate: str, prior_questions: list[str], fallback: str) -> str:
    normalized = (candidate or "").strip().lower().rstrip("?.!")
    seen = {(q or "").strip().lower().rstrip("?.!") for q in prior_questions}
    if normalized and normalized not in seen:
        return candidate
    return fallback


async def _resolve_next_main_question(
    *,
    lead: Optional[Lead],
    state: dict,
    questions: list[str],
    next_index: int,
    latest_candidate_response: str,
    answers: list[str],
) -> str:
    fallback_question = questions[next_index] if 0 <= next_index < len(questions) else "What date and time would be convenient for your demo discussion?"
    if next_index <= 0:
        return fallback_question

    asked_questions = list(state.get("asked_questions") or [])
    if not settings.MOCK_SERVICES and settings.OPENAI_API_KEY:
        generated = await generate_dynamic_next_question(
            company_name=COMPANY_NAME,
            caller_name=AI_CALLER_NAME,
            interest=lead.interest if lead else None,
            job_role=lead.job_role if lead else None,
            lead_description=lead.description if lead else None,
            latest_candidate_response=latest_candidate_response,
            prior_answers=answers,
            prior_questions=asked_questions,
        )
        return _ensure_not_repeated_question(generated, asked_questions, fallback_question)
    return fallback_question


def _sales_candidate_concern_reply(candidate_text: str) -> str | None:
    text = (candidate_text or "").lower()
    if any(phrase in text for phrase in ["what is demo", "demo for", "why demo", "demo required", "demo mean", "about the demo session"]):
        return (
            "Great question. This demo is a guided walkthrough where we show the course structure, projects, tools, "
            "learning path, and outcomes so you can decide confidently."
        )
    if any(word in text for word in ["demo", "course", "details", "detail", "information", "info", "fees", "fee", "cost", "price", "duration", "syllabus", "curriculum"]):
        return (
            "Happy to explain. In the demo we cover curriculum, class format, projects, timeline, and pricing clearly."
        )
    if any(word in text for word in ["salary", "package", "ctc", "pay"]):
        return "Thank you for asking. Compensation details are shared by our recruitment team after the next screening step."
    if any(word in text for word in ["location", "remote", "hybrid", "onsite"]):
        return "Thank you for asking. Work location and mode are confirmed by the hiring team based on the role and project."
    if any(word in text for word in ["company", "walkin", "software", "know more", "about this", "about the", "demo", "product", "service"]):
        return f"{COMPANY_NAME} is a software-focused organization, and our team is contacting you regarding your role interest."
    if any(word in text for word in ["when", "process", "next", "timeline"]):
        return "Our recruitment team will contact you with the next steps soon after this call."
    return None


def _is_candidate_clarification_request(candidate_text: str) -> bool:
    text = (candidate_text or "").strip().lower()
    if not text:
        return False
    if "?" in text:
        return True
    clarification_markers = [
        "know more",
        "tell me more",
        "more info",
        "more information",
        "could you explain",
        "can you explain",
        "what is",
        "how much",
        "fees",
        "fee",
        "cost",
        "price",
        "course",
        "demo",
        "duration",
        "syllabus",
        "curriculum",
        "batch",
        "timing",
    ]
    return any(marker in text for marker in clarification_markers)


def _is_affirmative_interest(candidate_text: str) -> bool:
    text = (candidate_text or "").strip().lower()
    if not text:
        return False
    affirmative_markers = [
        "yes",
        "yeah",
        "yep",
        "interested",
        "i am interested",
        "book it",
        "book demo",
        "please book",
        "sure",
        "okay",
        "ok",
    ]
    return any(marker in text for marker in affirmative_markers)


def _is_skip_request(candidate_text: str) -> bool:
    text = (candidate_text or "").strip().lower()
    if not text:
        return False
    markers = [
        "skip",
        "skip this",
        "skip question",
        "next question",
        "move on",
        "pass",
    ]
    return any(marker in text for marker in markers)


def _is_repeat_request(candidate_text: str) -> bool:
    text = (candidate_text or "").strip().lower()
    if not text:
        return False
    markers = [
        "repeat",
        "say again",
        "come again",
        "pardon",
        "didn't catch",
        "what was the question",
        "which question",
    ]
    return any(marker in text for marker in markers)


def _should_generate_cross_questions(asked_question: str, candidate_response: str) -> bool:
    question = (asked_question or "").strip().lower()
    response = (candidate_response or "").strip().lower()
    if not response:
        return False

    # Skip cross-questions for scheduling-style prompts.
    if any(token in question for token in ["date", "time", "slot", "schedule", "convenient"]):
        return False

    # Skip for very short acknowledgements.
    if response in {"yes", "yes please", "okay", "ok", "sure", "fine", "no", "nope"}:
        return False

    # Skip when candidate explicitly asks to skip/repeat.
    if _is_skip_request(response) or _is_repeat_request(response):
        return False

    # Generate only when the response has some useful content.
    return len(response.split()) >= 5


def _sales_no_input_prompt(question: str, retry_count: int) -> str:
    if retry_count <= 0:
        return f"I didn't catch that. {question}"
    return f"I'm sorry, I still could not hear your response clearly. {question}"


def _sales_call_state(call: Call) -> dict:
    metadata = dict(call.metadata_ or {})
    state = metadata.get("sales_call_state") or {}
    return dict(state)


def _update_sales_call_state(call: Call, state: dict) -> None:
    metadata = dict(call.metadata_ or {})
    metadata["sales_call_state"] = state
    call.metadata_ = metadata


def _conversation_action_url() -> str:
    return f"{_public_base_url()}/api/calls/webhooks/twilio/conversation"


def _build_gather_twiml(prompt: str) -> str:
    response = VoiceResponse()
    gather = Gather(
        input="speech",
        action=_conversation_action_url(),
        method="POST",
        speech_timeout="auto",
        timeout=6,
        action_on_empty_result=True,
    )
    gather.say(prompt, voice="alice")
    response.append(gather)
    response.say("I did not receive a response. Please hold while I repeat the question.", voice="alice")
    response.redirect(_conversation_action_url(), method="POST")
    return str(response)


def _build_realtime_stream_twiml(fallback_prompt: str) -> str:
    stream_url = f"{_public_wss_base_url()}/calls/ws/media"
    response = VoiceResponse()
    connect = response.connect()
    connect.stream(url=stream_url)

    # If realtime stream ends/fails, continue the call with stable Gather mode.
    gather = Gather(
        input="speech",
        action=_conversation_action_url(),
        method="POST",
        speech_timeout="auto",
        timeout=6,
        action_on_empty_result=True,
    )
    gather.say(fallback_prompt, voice="alice")
    response.append(gather)
    response.say("I did not receive a response. Please hold while I repeat the question.", voice="alice")
    response.redirect(_conversation_action_url(), method="POST")
    return str(response)


def _build_closing_twiml(message: str) -> str:
    response = VoiceResponse()
    response.say(message, voice="alice")
    response.hangup()
    return str(response)


async def _append_conversation_message(
    db: AsyncSession,
    call: Call,
    *,
    role: str,
    content: str,
    intent: str,
    confidence: float | None = None,
) -> None:
    if not content.strip():
        return
    conversation = await _ensure_conversation_for_call(db, call)
    db.add(
        ConversationMessage(
            conversation_id=conversation.id,
            role=role,
            content=content.strip(),
            intent=intent,
            confidence=confidence,
        )
    )


def _build_realtime_system_prompt(lead: Lead | None, questions: list[str]) -> str:
    lead_name = lead.full_name if lead else "Candidate"
    interest_label = _lead_interest_label(lead) if lead else "the role discussed"
    numbered_questions = "\n".join([f"{idx + 1}. {question}" for idx, question in enumerate(questions[:3])])
    return (
        f"You are {AI_CALLER_NAME}, a professional sales executive from {COMPANY_NAME}. "
        "This is a live phone conversation with a candidate. "
        f"Greet the candidate by name ({lead_name}), mention the call is about their interest in {interest_label}, "
        "and then ask qualification questions one by one. "
        "After each candidate response, acknowledge briefly and continue with the next question. "
        "If the candidate asks something outside the flow, answer briefly and steer back to the next question. "
        "If the interest is demo, ensure a date and time is captured. "
        "When all questions are done, thank the candidate and end politely. "
        "Keep each response short and natural for phone conversation. "
        "The target question sequence is:\n"
        f"{numbered_questions}"
    )


def _twilio_media_to_pcm24k(media_payload_b64: str) -> bytes:
    ulaw_bytes = base64.b64decode(media_payload_b64)
    pcm8k = audioop.ulaw2lin(ulaw_bytes, 2)
    pcm24k, _ = audioop.ratecv(pcm8k, 2, 1, 8000, 24000, None)
    return pcm24k


def _pcm24k_to_twilio_media_b64(pcm24k: bytes) -> str:
    pcm8k, _ = audioop.ratecv(pcm24k, 2, 1, 24000, 8000, None)
    ulaw_bytes = audioop.lin2ulaw(pcm8k, 2)
    return base64.b64encode(ulaw_bytes).decode()


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
    auth = _twilio_http_auth()
    if not auth:
        raise HTTPException(status_code=500, detail="Twilio credentials are required to fetch external recordings")

    errors: list[str] = []
    unauthorized = False
    async with httpx.AsyncClient(
        auth=auth,
        timeout=60.0,
    ) as client:
        for url in _recording_url_candidates(recording_url):
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                media_type = resp.headers.get("content-type") or "audio/mpeg"
                return resp.content, media_type
            except Exception as exc:
                if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 401:
                    unauthorized = True
                errors.append(f"{url}: {exc}")

    if unauthorized:
        raise HTTPException(
            status_code=502,
            detail=(
                "Failed to fetch external recording: Twilio returned 401 Unauthorized. "
                "Update TWILIO_AUTH_TOKEN or configure TWILIO_API_KEY/TWILIO_API_SECRET in backend env."
            ),
        )

    raise HTTPException(status_code=502, detail=f"Failed to fetch external recording: {' | '.join(errors)}")


async def _refresh_recording_url_from_twilio(db: AsyncSession, call: Call) -> bool:
    if not call.twilio_call_sid:
        return False
    if not settings.TWILIO_ACCOUNT_SID or not _twilio_http_auth():
        return False

    client = _twilio_client()
    recording = None

    if call.recording_sid:
        try:
            recording = client.recordings(call.recording_sid).fetch()
        except Exception:
            recording = None

    if recording is None:
        candidate_call_sids = [call.twilio_call_sid]
        try:
            tw_call = client.calls(call.twilio_call_sid).fetch()
            parent_sid = getattr(tw_call, "parent_call_sid", None)
            if parent_sid and parent_sid not in candidate_call_sids:
                candidate_call_sids.append(parent_sid)
            child_calls = client.calls.list(parent_call_sid=call.twilio_call_sid, limit=20)
            for child in child_calls:
                child_sid = getattr(child, "sid", None)
                if child_sid and child_sid not in candidate_call_sids:
                    candidate_call_sids.append(child_sid)
        except Exception:
            # Best-effort: keep fallback resilient even if Twilio call graph lookup fails.
            pass

        for sid in candidate_call_sids:
            try:
                rows = client.recordings.list(call_sid=sid, limit=1)
                if rows:
                    recording = rows[0]
                    break
            except Exception:
                continue

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
    page_size: int = Query(10, ge=1, le=100),
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

    if twilio_live_mode and page == 1:
        client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        # Keep the first page fresh without making every paginated request expensive.
        await _import_recent_twilio_calls(db, client, limit=min(max(page_size * 2, 20), 50))

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
    query = query.order_by(Call.created_at.desc(), Call.id.desc()).offset(offset).limit(page_size)
    result = await db.execute(query)
    calls = result.scalars().all()

    # Keep DB history fresh even if Twilio webhook delivery is delayed/missed.
    if twilio_live_mode and page == 1:
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

    # Queue-based scheduling is durable and survives API restarts.
    try:
        trigger_outbound_call.apply_async(args=[lead_id, to_number], countdown=int(delay), queue="call")
    except Exception as exc:
        logger.warning(f"Scheduled queue unavailable, using in-process fallback: {exc}")
        background_tasks.add_task(delayed_call_trigger, lead_id, to_number, delay)
        return {
            "status": "scheduled",
            "delay_seconds": delay,
            "scheduled_at": scheduled_at,
            "queued": False,
            "fallback": "background_task",
        }
    return {
        "status": "scheduled",
        "delay_seconds": delay,
        "scheduled_at": scheduled_at,
        "queued": True,
    }


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
    sales_questions = await _build_sales_call_questions(lead)
    initial_prompt = _initial_sales_prompt(
        lead,
        sales_questions[0],
        payload.message,
    )

    twilio_sid = None
    provider_status = "initiated"
    provider = "mock"

    if not settings.MOCK_SERVICES:
        if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN or not settings.TWILIO_PHONE_NUMBER:
            raise HTTPException(status_code=500, detail="Twilio credentials are not configured.")

        try:
            client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
            base_url = _public_base_url()
            # Use the Gather flow as the stable production path; follow-up turns are
            # generated dynamically in the conversation webhook.
            twiml_payload = _build_gather_twiml(initial_prompt)
            twilio_call = client.calls.create(
                to=to_number,
                from_=settings.TWILIO_PHONE_NUMBER,
                twiml=twiml_payload,
                record=True,
                status_callback=f"{base_url}/api/calls/webhooks/twilio/status",
                status_callback_event=["initiated", "ringing", "answered", "completed"],
                status_callback_method="POST",
                recording_status_callback=f"{base_url}/api/calls/webhooks/twilio/recording",
                recording_status_callback_method="POST",
            )
            twilio_sid = twilio_call.sid
            provider_status = _normalize_call_status(twilio_call.status, 0)
            provider = "twilio"
            logger.info(
                f"Outbound call triggered sid={twilio_sid} lead_id={lead.id} to={to_number} "
                f"mode=gather_ai"
            )
        except TwilioRestException as exc:
            logger.error(f"Twilio outbound call failed lead_id={lead.id} to={to_number}: {exc.msg}")
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
        metadata_={
            "ai_script": initial_prompt,
            "source": "crm_outbound",
            "provider": provider,
            "call_mode": "gather_ai",
            "sales_call_state": {
                "questions": sales_questions,
                "answers": [],
                "asked_questions": [sales_questions[0]] if sales_questions else [],
                "current_question_index": 0,
                "no_input_retries": 0,
                "completed": False,
                "company_name": COMPANY_NAME,
                "caller_name": AI_CALLER_NAME,
            },
            "retry_attempt": 0,
        },
        started_at=datetime.now(timezone.utc),
    )
    db.add(call)

    if lead.status == "new":
        lead.status = "contacted"

    await db.commit()
    await db.refresh(call)

    await _append_conversation_message(
        db,
        call,
        role="assistant",
        content=initial_prompt,
        intent="sales_question_1",
        confidence=1.0,
    )
    await db.commit()
    OUTBOUND_CALLS_TOTAL.inc()

    return {
        "call_id": call.id,
        "lead_id": lead.id,
        "status": call.status,
        "provider": provider,
        "twilio_call_sid": twilio_sid,
        "ai_script": initial_prompt,
        "to_number": to_number,
        "call_mode": "gather_ai",
    }


@router.post("/internal/outbound")
async def outbound_call_internal(
    payload: OutboundCallRequest,
    x_internal_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    _verify_internal_token(x_internal_token)
    internal_user = type("InternalUser", (), {"id": "internal-worker"})()
    return await outbound_call(payload, db, internal_user)


@router.get("/webhooks/twilio/conversation")
async def twilio_conversation_webhook_probe():
    # Some tunnel checks/manual tests use GET; keep this endpoint non-404.
    return {"status": "ok", "endpoint": "twilio_conversation", "method": "GET"}


@router.post("/webhooks/twilio/conversation")
async def twilio_conversation_webhook(
    CallSid: str = Form(...),
    SpeechResult: Optional[str] = Form(None),
    Confidence: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    try:
        logger.info(f"Twilio conversation webhook sid={CallSid} speech={(SpeechResult or '').strip()!r}")
        call = (await db.execute(select(Call).where(Call.twilio_call_sid == CallSid))).scalar_one_or_none()
        if not call:
            return Response(content=_build_closing_twiml("We could not locate this call session. Goodbye."), media_type="application/xml")

        lead = None
        if call.lead_id:
            lead = (await db.execute(select(Lead).where(Lead.id == call.lead_id))).scalar_one_or_none()

        state = _sales_call_state(call)
        questions = list(state.get("questions") or [])
        asked_questions = list(state.get("asked_questions") or [])
        if not questions:
            interest_label = _lead_interest_label(lead) if lead else "this opportunity"
            questions = _fallback_sales_questions(interest_label)
            state["questions"] = questions
        if not asked_questions and questions:
            asked_questions = [questions[0]]
            state["asked_questions"] = asked_questions

        current_index = max(0, min(int(state.get("current_question_index", 0)), len(questions) - 1))
        answers = list(state.get("answers") or [])
        no_input_retries = int(state.get("no_input_retries", 0))
        clarification_retries = int(state.get("clarification_retries", 0))
        total_clarifications = int(state.get("total_clarifications", 0))
        pending_cross_questions = list(state.get("pending_cross_questions") or [])
        is_cross_answer = bool(pending_cross_questions)
        active_question = _active_sales_question(state, questions, current_index)
        speech_text = (SpeechResult or "").strip()
        confidence_value = None
        if Confidence:
            try:
                confidence_value = float(Confidence)
            except ValueError:
                confidence_value = None

        if not speech_text:
            if no_input_retries >= MAX_NO_INPUT_RETRIES:
                closing_prompt = "Since I could not hear your response clearly, I will end the call for now. Thank you for your time."
                await _append_conversation_message(
                    db,
                    call,
                    role="assistant",
                    content=closing_prompt,
                    intent="sales_closing",
                    confidence=1.0,
                )
                state["completed"] = True
                state["completed_at"] = datetime.now(timezone.utc).isoformat()
                _update_sales_call_state(call, state)
                await db.commit()
                return Response(content=_build_closing_twiml(closing_prompt), media_type="application/xml")

            repeat_prompt = _sales_no_input_prompt(active_question, no_input_retries)
            await _append_conversation_message(
                db,
                call,
                role="assistant",
                content=repeat_prompt,
                intent=f"sales_question_repeat_{current_index + 1}",
                confidence=1.0,
            )
            state["no_input_retries"] = no_input_retries + 1
            _update_sales_call_state(call, state)
            await db.commit()
            return Response(content=_build_gather_twiml(repeat_prompt), media_type="application/xml")

        is_clarification = _is_candidate_clarification_request(speech_text)
        is_skip = _is_skip_request(speech_text)
        is_repeat = _is_repeat_request(speech_text)

        if is_repeat:
            await _append_conversation_message(
                db,
                call,
                role="user",
                content=speech_text,
                intent=f"sales_repeat_request_{current_index + 1}",
                confidence=confidence_value,
            )
            repeat_prompt = f"Sure. {active_question}"
            await _append_conversation_message(
                db,
                call,
                role="assistant",
                content=repeat_prompt,
                intent=f"sales_repeat_prompt_{current_index + 1}",
                confidence=1.0,
            )
            state["no_input_retries"] = 0
            _update_sales_call_state(call, state)
            await db.commit()
            return Response(content=_build_gather_twiml(repeat_prompt), media_type="application/xml")

        if is_skip:
            await _append_conversation_message(
                db,
                call,
                role="user",
                content=speech_text,
                intent=(
                    f"sales_cross_skip_{current_index + 1}"
                    if is_cross_answer
                    else f"sales_main_skip_{current_index + 1}"
                ),
                confidence=confidence_value,
            )

            if is_cross_answer:
                remaining_cross = pending_cross_questions[1:]
                state["pending_cross_questions"] = remaining_cross
                if remaining_cross:
                    next_prompt = f"No problem. {remaining_cross[0]}"
                    await _append_conversation_message(
                        db,
                        call,
                        role="assistant",
                        content=next_prompt,
                        intent=f"sales_cross_question_{current_index + 1}",
                        confidence=1.0,
                    )
                    _update_sales_call_state(call, state)
                    await db.commit()
                    return Response(content=_build_gather_twiml(next_prompt), media_type="application/xml")

            # Move to next main question if available, otherwise close.
            if current_index >= len(questions) - 1:
                closing_prompt = _sales_closing_prompt()
                await _append_conversation_message(
                    db,
                    call,
                    role="assistant",
                    content=closing_prompt,
                    intent="sales_closing",
                    confidence=1.0,
                )
                state["completed"] = True
                state["completed_at"] = datetime.now(timezone.utc).isoformat()
                _update_sales_call_state(call, state)
                await db.commit()
                return Response(content=_build_closing_twiml(closing_prompt), media_type="application/xml")

            next_index = current_index + 1
            next_main_question = await _resolve_next_main_question(
                lead=lead,
                state=state,
                questions=questions,
                next_index=next_index,
                latest_candidate_response=speech_text,
                answers=answers,
            )
            next_prompt = f"Sure, we can skip that. {next_main_question}"
            await _append_conversation_message(
                db,
                call,
                role="assistant",
                content=next_prompt,
                intent=f"sales_question_{next_index + 1}",
                confidence=1.0,
            )
            state["current_question_index"] = next_index
            state["pending_cross_questions"] = []
            state["clarification_retries"] = 0
            state["no_input_retries"] = 0
            _update_sales_call_state(call, state)
            await db.commit()
            return Response(content=_build_gather_twiml(next_prompt), media_type="application/xml")

        await _append_conversation_message(
            db,
            call,
            role="user",
            content=speech_text,
            intent=(
                f"sales_clarification_user_{current_index + 1}"
                if is_clarification
                else f"sales_answer_{current_index + 1}"
            ),
            confidence=confidence_value,
        )

        # If the candidate asks a clarification question, answer dynamically and
        # re-ask the same screening question instead of advancing the flow.
        if is_clarification:
            is_initial_interest_question = (
                not is_cross_answer
                and current_index == 0
                and "interested" in (questions[current_index] or "").lower()
            )
            if is_initial_interest_question and _is_affirmative_interest(speech_text):
                answers.append(speech_text)
                state["answers"] = answers
                state["clarification_retries"] = 0
                state["total_clarifications"] = total_clarifications + 1
                next_index = 1 if len(questions) > 1 else 0
                next_main_question = await _resolve_next_main_question(
                    lead=lead,
                    state=state,
                    questions=questions,
                    next_index=next_index,
                    latest_candidate_response=speech_text,
                    answers=answers,
                )
                fallback_prompt = (
                    "Great question. I can share the main details now, and our team will help with deeper points. "
                    f"Great, {next_main_question}"
                )
                next_prompt = fallback_prompt
                if not settings.MOCK_SERVICES and settings.OPENAI_API_KEY:
                    generated_prompt = await generate_sales_call_turn(
                        company_name=COMPANY_NAME,
                        caller_name=AI_CALLER_NAME,
                        full_name=lead.full_name if lead and lead.full_name else "there",
                        interest=lead.interest if lead else None,
                        job_role=lead.job_role if lead else None,
                        lead_description=lead.description if lead else None,
                        latest_candidate_response=speech_text,
                        next_question=next_main_question,
                        prior_answers=answers[:-1],
                        prior_questions=asked_questions,
                        closing=False,
                    )
                    next_prompt = (generated_prompt or "").strip() or fallback_prompt

                await _append_conversation_message(
                    db,
                    call,
                    role="assistant",
                    content=next_prompt,
                    intent=f"sales_question_{next_index + 1}",
                    confidence=1.0,
                )
                state["current_question_index"] = next_index
                asked_questions.append(next_main_question)
                state["asked_questions"] = asked_questions
                state["pending_cross_questions"] = []
                state["no_input_retries"] = 0
                _update_sales_call_state(call, state)
                await db.commit()
                return Response(content=_build_gather_twiml(next_prompt), media_type="application/xml")

            clarification_retries += 1
            total_clarifications += 1
            state["clarification_retries"] = clarification_retries
            state["total_clarifications"] = total_clarifications

            if (
                clarification_retries > MAX_CLARIFICATION_RETRIES_PER_QUESTION
                or total_clarifications > MAX_TOTAL_CLARIFICATION_RETRIES
            ):
                closing_prompt = _sales_clarification_limit_prompt()
                await _append_conversation_message(
                    db,
                    call,
                    role="assistant",
                    content=closing_prompt,
                    intent="sales_closing_clarification_limit",
                    confidence=1.0,
                )
                state["completed"] = True
                state["completed_at"] = datetime.now(timezone.utc).isoformat()
                _update_sales_call_state(call, state)
                await db.commit()
                return Response(content=_build_closing_twiml(closing_prompt), media_type="application/xml")

            fallback_prompt = (
                "Thanks for your question. Based on current details, our team can clarify anything beyond this. "
                f"To proceed, {active_question}"
            )
            next_prompt = fallback_prompt
            if not settings.MOCK_SERVICES and settings.OPENAI_API_KEY:
                generated_prompt = await generate_sales_call_turn(
                    company_name=COMPANY_NAME,
                    caller_name=AI_CALLER_NAME,
                    full_name=lead.full_name if lead and lead.full_name else "there",
                    interest=lead.interest if lead else None,
                    job_role=lead.job_role if lead else None,
                    lead_description=lead.description if lead else None,
                    latest_candidate_response=speech_text,
                    next_question=active_question,
                    prior_answers=answers,
                    prior_questions=asked_questions,
                    closing=False,
                )
                next_prompt = (generated_prompt or "").strip() or fallback_prompt

            await _append_conversation_message(
                db,
                call,
                role="assistant",
                content=next_prompt,
                intent=f"sales_clarification_{current_index + 1}",
                confidence=1.0,
            )
            state["no_input_retries"] = 0
            _update_sales_call_state(call, state)
            await db.commit()
            logger.info(f"Twilio clarification reply sid={CallSid} prompt={next_prompt!r}")
            return Response(content=_build_gather_twiml(next_prompt), media_type="application/xml")

        answers.append(speech_text)
        state["answers"] = answers
        state["no_input_retries"] = 0
        state["clarification_retries"] = 0

        # If candidate just answered a cross-question, continue remaining cross-questions
        # for this round before moving to the next main question.
        if is_cross_answer:
            remaining_cross = pending_cross_questions[1:]
            state["pending_cross_questions"] = remaining_cross
            if remaining_cross:
                next_cross_question = remaining_cross[0]
                next_prompt = _sales_followup_prompt(next_cross_question)
                if not settings.MOCK_SERVICES and settings.OPENAI_API_KEY:
                    generated_prompt = await generate_sales_call_turn(
                        company_name=COMPANY_NAME,
                        caller_name=AI_CALLER_NAME,
                        full_name=lead.full_name if lead and lead.full_name else "there",
                        interest=lead.interest if lead else None,
                        job_role=lead.job_role if lead else None,
                        lead_description=lead.description if lead else None,
                        latest_candidate_response=speech_text,
                        next_question=next_cross_question,
                        prior_answers=answers[:-1],
                        prior_questions=asked_questions,
                        closing=False,
                    )
                    next_prompt = (generated_prompt or "").strip() or next_prompt
                await _append_conversation_message(
                    db,
                    call,
                    role="assistant",
                    content=next_prompt,
                    intent=f"sales_cross_question_{current_index + 1}",
                    confidence=1.0,
                )
                _update_sales_call_state(call, state)
                await db.commit()
                return Response(content=_build_gather_twiml(next_prompt), media_type="application/xml")

            # Cross-question sequence complete; now move to the next main round.
            if current_index >= len(questions) - 1:
                closing_prompt = _sales_closing_prompt()
                await _append_conversation_message(
                    db,
                    call,
                    role="assistant",
                    content=closing_prompt,
                    intent="sales_closing",
                    confidence=1.0,
                )
                conversation = await _ensure_conversation_for_call(db, call)
                conversation.summary = " ".join(answer.strip() for answer in answers if answer.strip())[:500] or conversation.summary
                state["completed"] = True
                state["completed_at"] = datetime.now(timezone.utc).isoformat()
                _update_sales_call_state(call, state)
                await db.commit()
                return Response(content=_build_closing_twiml(closing_prompt), media_type="application/xml")

            next_index = current_index + 1
            next_main_question = await _resolve_next_main_question(
                lead=lead,
                state=state,
                questions=questions,
                next_index=next_index,
                latest_candidate_response=speech_text,
                answers=answers,
            )
            main_prompt = _sales_followup_prompt(next_main_question)
            if not settings.MOCK_SERVICES and settings.OPENAI_API_KEY:
                generated_prompt = await generate_sales_call_turn(
                    company_name=COMPANY_NAME,
                    caller_name=AI_CALLER_NAME,
                    full_name=lead.full_name if lead and lead.full_name else "there",
                    interest=lead.interest if lead else None,
                    job_role=lead.job_role if lead else None,
                    lead_description=lead.description if lead else None,
                    latest_candidate_response=speech_text,
                    next_question=next_main_question,
                    prior_answers=answers[:-1],
                    prior_questions=asked_questions,
                    closing=False,
                )
                main_prompt = (generated_prompt or "").strip() or main_prompt
            await _append_conversation_message(
                db,
                call,
                role="assistant",
                content=main_prompt,
                intent=f"sales_question_{next_index + 1}",
                confidence=1.0,
            )
            state["current_question_index"] = next_index
            asked_questions.append(next_main_question)
            state["asked_questions"] = asked_questions
            _update_sales_call_state(call, state)
            await db.commit()
            return Response(content=_build_gather_twiml(main_prompt), media_type="application/xml")

        # Answer to a main question: generate cross-questions dynamically from response.
        if MAX_CROSS_QUESTIONS_PER_ANSWER > 0 and current_index < len(questions) - 1 and _should_generate_cross_questions(questions[current_index], speech_text):
            cross_questions = await generate_sales_cross_questions(
                company_name=COMPANY_NAME,
                caller_name=AI_CALLER_NAME,
                interest=lead.interest if lead else None,
                job_role=lead.job_role if lead else None,
                asked_question=questions[current_index],
                candidate_response=speech_text,
                max_questions=MAX_CROSS_QUESTIONS_PER_ANSWER,
            )
            if cross_questions:
                state["pending_cross_questions"] = cross_questions
                first_cross_question = cross_questions[0]
                cross_prompt = _sales_followup_prompt(first_cross_question)
                if not settings.MOCK_SERVICES and settings.OPENAI_API_KEY:
                    generated_prompt = await generate_sales_call_turn(
                        company_name=COMPANY_NAME,
                        caller_name=AI_CALLER_NAME,
                        full_name=lead.full_name if lead and lead.full_name else "there",
                        interest=lead.interest if lead else None,
                        job_role=lead.job_role if lead else None,
                        lead_description=lead.description if lead else None,
                        latest_candidate_response=speech_text,
                        next_question=first_cross_question,
                        prior_answers=answers[:-1],
                        prior_questions=asked_questions,
                        closing=False,
                    )
                    cross_prompt = (generated_prompt or "").strip() or cross_prompt
                await _append_conversation_message(
                    db,
                    call,
                    role="assistant",
                    content=cross_prompt,
                    intent=f"sales_cross_question_{current_index + 1}",
                    confidence=1.0,
                )
                _update_sales_call_state(call, state)
                await db.commit()
                return Response(content=_build_gather_twiml(cross_prompt), media_type="application/xml")

        if current_index >= len(questions) - 1:
            closing_prompt = _sales_closing_prompt()
            await _append_conversation_message(
                db,
                call,
                role="assistant",
                content=closing_prompt,
                intent="sales_closing",
                confidence=1.0,
            )
            conversation = await _ensure_conversation_for_call(db, call)
            conversation.summary = " ".join(answer.strip() for answer in answers if answer.strip())[:500] or conversation.summary
            state["completed"] = True
            state["completed_at"] = datetime.now(timezone.utc).isoformat()
            _update_sales_call_state(call, state)
            await db.commit()
            return Response(content=_build_closing_twiml(closing_prompt), media_type="application/xml")

        next_index = current_index + 1
        next_main_question = await _resolve_next_main_question(
            lead=lead,
            state=state,
            questions=questions,
            next_index=next_index,
            latest_candidate_response=speech_text,
            answers=answers,
        )
        fallback_prompt = _sales_followup_prompt(next_main_question)
        next_prompt = fallback_prompt
        if not settings.MOCK_SERVICES and settings.OPENAI_API_KEY:
            generated_prompt = await generate_sales_call_turn(
                company_name=COMPANY_NAME,
                caller_name=AI_CALLER_NAME,
                full_name=lead.full_name if lead and lead.full_name else "there",
                interest=lead.interest if lead else None,
                job_role=lead.job_role if lead else None,
                lead_description=lead.description if lead else None,
                latest_candidate_response=speech_text,
                next_question=next_main_question,
                prior_answers=answers[:-1],
                prior_questions=asked_questions,
                closing=False,
            )
            next_prompt = (generated_prompt or "").strip() or fallback_prompt
        await _append_conversation_message(
            db,
            call,
            role="assistant",
            content=next_prompt,
            intent=f"sales_question_{next_index + 1}",
            confidence=1.0,
        )
        state["current_question_index"] = next_index
        asked_questions.append(next_main_question)
        state["asked_questions"] = asked_questions
        _update_sales_call_state(call, state)
        await db.commit()
        logger.info(f"Twilio conversation next prompt sid={CallSid} prompt={next_prompt!r}")
        return Response(content=_build_gather_twiml(next_prompt), media_type="application/xml")
    except Exception:
        logger.exception(f"Twilio conversation webhook failed sid={CallSid}")
        # Always return valid TwiML so Twilio does not play an application error message.
        return Response(
            content=_build_closing_twiml("Thank you for your time. We will call you again shortly."),
            media_type="application/xml",
        )


@router.websocket("/ws/media")
async def twilio_media_stream_bridge(
    websocket: WebSocket,
    db: AsyncSession = Depends(get_db),
):
    await websocket.accept()

    stream_sid: str | None = None
    call: Call | None = None
    lead: Lead | None = None
    ai_session_ready = asyncio.Event()

    if not settings.ASSEMBLYAI_API_KEY or not settings.ASSEMBLYAI_REALTIME_WS_URL:
        logger.error("Realtime stream rejected: AssemblyAI realtime provider is not configured")
        await websocket.close(code=1000)
        return

    # Build a certifi-backed SSL context so macOS Python trusts AssemblyAI's cert.
    _ssl_ctx = ssl.create_default_context(cafile=certifi.where())

    try:
        logger.info("Twilio media websocket connected; initializing realtime AI bridge")
        async with websockets.connect(
            settings.ASSEMBLYAI_REALTIME_WS_URL,
            ssl=_ssl_ctx,
            additional_headers={"Authorization": f"Bearer {settings.ASSEMBLYAI_API_KEY}"},
            ping_interval=20,
            ping_timeout=20,
        ) as ai_ws:
            logger.info("Realtime AI websocket connected")

            # AssemblyAI agents API starts speaking immediately on session.update;
            # it does NOT send a session.ready event.  Mark ready right away.
            ai_session_ready.set()

            async def ai_listener() -> None:
                nonlocal stream_sid
                async for raw_message in ai_ws:
                    try:
                        event = json.loads(raw_message)
                    except Exception:
                        # Binary frame — skip
                        continue
                    event_type = event.get("type")

                    # session.ready (some providers send this, AssemblyAI does not)
                    if event_type == "session.ready":
                        logger.info(f"Realtime AI session ready stream_sid={stream_sid}")
                        ai_session_ready.set()
                        continue

                    if event_type in {"error", "session.error"}:
                        logger.error(f"Realtime AI error stream_sid={stream_sid}: {event}")
                        continue

                    # AssemblyAI audio reply: {"reply_id": "...", "data": "<base64-pcm>"}
                    # No "type" field — detect by presence of "data" key.
                    if "data" in event and event_type is None and stream_sid:
                        try:
                            pcm_bytes = base64.b64decode(event["data"])
                            twilio_payload = _pcm24k_to_twilio_media_b64(pcm_bytes)
                            await websocket.send_json(
                                {
                                    "event": "media",
                                    "streamSid": stream_sid,
                                    "media": {"payload": twilio_payload},
                                }
                            )
                        except Exception as audio_err:
                            logger.error(f"Failed to forward AI audio to Twilio: {audio_err}")
                        continue

                    # Legacy OpenAI Realtime-style audio event
                    if event_type == "reply.audio" and stream_sid:
                        try:
                            pcm24k = base64.b64decode(event.get("data", ""))
                            twilio_payload = _pcm24k_to_twilio_media_b64(pcm24k)
                            await websocket.send_json(
                                {
                                    "event": "media",
                                    "streamSid": stream_sid,
                                    "media": {"payload": twilio_payload},
                                }
                            )
                        except Exception as audio_err:
                            logger.error(f"Failed to forward AI audio (reply.audio) to Twilio: {audio_err}")
                        continue

                    if event_type in {"transcript.user", "transcript.human"} and call:
                        await _append_conversation_message(
                            db,
                            call,
                            role="user",
                            content=(event.get("text") or "").strip(),
                            intent="realtime_user_transcript",
                            confidence=1.0,
                        )
                        await db.commit()
                        continue

                    if event_type == "transcript.agent" and call:
                        logger.info(f"AI agent said: '{(event.get('text') or '').strip()}'")
                        await _append_conversation_message(
                            db,
                            call,
                            role="assistant",
                            content=(event.get("text") or "").strip(),
                            intent="realtime_agent_transcript",
                            confidence=1.0,
                        )
                        await db.commit()
                        continue

            ai_task = asyncio.create_task(ai_listener())

            try:
                while True:
                    raw = await websocket.receive_text()
                    try:
                        payload = json.loads(raw)
                    except Exception:
                        logger.error("Invalid Twilio media payload received (non-JSON)")
                        continue
                    event = payload.get("event")

                    if event == "start":
                        start_data = payload.get("start") or {}
                        stream_sid = start_data.get("streamSid")
                        call_sid = start_data.get("callSid")
                        logger.info(f"Twilio media stream start call_sid={call_sid} stream_sid={stream_sid}")

                        if call_sid:
                            call = (
                                await db.execute(select(Call).where(Call.twilio_call_sid == call_sid))
                            ).scalar_one_or_none()
                            if call and call.lead_id:
                                lead = (
                                    await db.execute(select(Lead).where(Lead.id == call.lead_id))
                                ).scalar_one_or_none()

                        questions: list[str] = []
                        if call:
                            state = _sales_call_state(call)
                            questions = list(state.get("questions") or [])
                        if not questions:
                            interest_label = _lead_interest_label(lead) if lead else "this opportunity"
                            questions = _fallback_sales_questions(interest_label)

                        greeting = (
                            f"Hello {lead.full_name}, this is {AI_CALLER_NAME} from {COMPANY_NAME}."
                            if lead else f"Hello, this is {AI_CALLER_NAME} from {COMPANY_NAME}."
                        )
                        await ai_ws.send(
                            json.dumps(
                                {
                                    "type": "session.update",
                                    "session": {
                                        "system_prompt": _build_realtime_system_prompt(lead, questions),
                                        "greeting": greeting,
                                        "output": {"voice": settings.ASSEMBLYAI_REALTIME_VOICE},
                                    },
                                }
                            )
                        )
                        logger.info(f"Realtime session.update sent call_sid={call_sid} stream_sid={stream_sid}")
                        continue

                    if event == "media":
                        if not ai_session_ready.is_set():
                            continue
                        media = payload.get("media") or {}
                        media_payload = media.get("payload")
                        if not media_payload:
                            continue
                        pcm24k = _twilio_media_to_pcm24k(media_payload)
                        # Send user audio to AssemblyAI agents API.
                        await ai_ws.send(
                            json.dumps(
                                {
                                    "type": "input.audio",
                                    "audio": base64.b64encode(pcm24k).decode(),
                                }
                            )
                        )
                        continue

                    if event == "stop":
                        logger.info(f"Twilio media stream stop stream_sid={stream_sid}")
                        break

                    if event == "connected":
                        logger.info("Twilio media stream connected event received")
                        continue
            except WebSocketDisconnect:
                logger.warning(f"Twilio media websocket disconnected stream_sid={stream_sid}")
            finally:
                ai_task.cancel()
                with contextlib.suppress(Exception):
                    await ai_task
                logger.info(f"Realtime bridge loop finalized stream_sid={stream_sid}")
    except Exception:
        logger.exception("Realtime bridge failure; falling back to Gather flow from TwiML")
        with contextlib.suppress(Exception):
            # Close normally so Twilio continues with fallback Gather in the same TwiML.
            await websocket.close(code=1000)


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
    CALL_STATUS_WEBHOOK_TOTAL.labels(status=call.status).inc()
    if CallDuration and str(CallDuration).isdigit():
        call.duration_seconds = int(CallDuration)
    if call.status in {"answered", "hangup", "no_response"} and not call.ended_at:
        call.ended_at = datetime.now(timezone.utc)

    metadata = dict(call.metadata_ or {})
    metadata["last_twilio_status"] = CallStatus
    if call.status in {"answered", "completed", "in_progress"}:
        metadata["retry_closed"] = True
    call.metadata_ = metadata

    await update_lead_score(
        db,
        lead_id=call.lead_id,
        score_delta=score_delta_from_call_status(call.status),
    )

    # Smart retry flow for missed outbound calls.
    if call.status in {"no_response", "no_answer", "busy", "failed"}:
        _queue_retry_for_call(call)

    await db.commit()
    logger.info(
        f"Twilio status webhook sid={CallSid} raw={CallStatus} normalized={call.status} "
        f"duration={call.duration_seconds}"
    )
    return {"status": "ok", "call_id": call.id, "normalized_status": call.status}


@router.get("/webhooks/twilio/status")
async def twilio_call_status_webhook_probe():
    # Some tunnel checks/manual tests use GET; keep this endpoint non-404.
    return {"status": "ok", "endpoint": "twilio_status", "method": "GET"}


@router.post("/webhooks/twilio/recording")
async def twilio_recording_webhook(
    CallSid: str = Form(...),
    ParentCallSid: Optional[str] = Form(None),
    DialCallSid: Optional[str] = Form(None),
    RecordingSid: Optional[str] = Form(None),
    RecordingUrl: Optional[str] = Form(None),
    RecordingDuration: Optional[str] = Form(None),
    TranscriptionText: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
):
    sid_candidates = [sid for sid in [CallSid, ParentCallSid, DialCallSid] if sid]
    call = None
    for sid in sid_candidates:
        call = (await db.execute(select(Call).where(Call.twilio_call_sid == sid))).scalar_one_or_none()
        if call:
            break

    if not call:
        return {"status": "ignored", "reason": "call_not_found", "twilio_call_sid": CallSid}

    normalized_url = _normalize_recording_url(RecordingUrl)
    if normalized_url:
        call.recording_url = normalized_url
    if RecordingSid:
        call.recording_sid = RecordingSid
    if RecordingDuration and str(RecordingDuration).isdigit():
        call.duration_seconds = int(RecordingDuration)

    transcript_text = (TranscriptionText or "").strip()
    if transcript_text:
        conversation = await _ensure_conversation_for_call(db, call)
        message = ConversationMessage(
            conversation_id=conversation.id,
            role="user",
            content=transcript_text,
            intent="call_transcript",
        )
        db.add(message)
        await db.flush()
        if not conversation.summary:
            conversation.summary = transcript_text[:500]
        await upsert_conversation_memory(
            db,
            lead_id=call.lead_id,
            conversation_id=conversation.id,
            message_id=message.id,
            content=transcript_text,
        )
    elif call.recording_url:
        try:
            transcribe_call_recording.delay(call.id)
        except Exception as exc:
            logger.warning(f"Transcript worker enqueue failed call={call.id}: {exc}")

    if call.status not in {"answered", "hangup", "no_response"}:
        call.status = _normalize_call_status("completed", call.duration_seconds)
    if not call.ended_at:
        call.ended_at = datetime.now(timezone.utc)

    metadata = dict(call.metadata_ or {})
    metadata["transcript_available"] = bool(transcript_text)
    if not transcript_text and call.recording_url:
        metadata["transcript_queued"] = True
    metadata["recording_webhook_received_at"] = datetime.now(timezone.utc).isoformat()
    metadata["recording_webhook_sids"] = sid_candidates
    call.metadata_ = metadata

    await db.commit()
    return {
        "status": "ok",
        "call_id": call.id,
        "recording_url": call.recording_url,
        "transcript_available": bool(transcript_text),
    }


@router.get("/webhooks/twilio/recording")
async def twilio_recording_webhook_probe():
    # Some tunnel checks/manual tests use GET; keep this endpoint non-404.
    return {"status": "ok", "endpoint": "twilio_recording", "method": "GET"}


@router.post("/internal/transcribe/{call_id}")
async def transcribe_call_internal(
    call_id: str,
    x_internal_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    _verify_internal_token(x_internal_token)

    call = (await db.execute(select(Call).where(Call.id == call_id))).scalar_one_or_none()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    if not call.recording_url:
        raise HTTPException(status_code=400, detail="Recording URL not available")

    transcript_text = await _transcribe_remote_recording(call.recording_url)
    if not transcript_text:
        return {"status": "noop", "call_id": call.id, "reason": "transcript_empty"}

    conversation = await _ensure_conversation_for_call(db, call)
    message = ConversationMessage(
        conversation_id=conversation.id,
        role="user",
        content=transcript_text,
        intent="call_transcript",
    )
    db.add(message)
    await db.flush()
    if not conversation.summary:
        conversation.summary = transcript_text[:500]

    await upsert_conversation_memory(
        db,
        lead_id=call.lead_id,
        conversation_id=conversation.id,
        message_id=message.id,
        content=transcript_text,
    )

    metadata = dict(call.metadata_ or {})
    metadata["transcript_available"] = True
    metadata["transcript_queued"] = False
    call.metadata_ = metadata

    await db.commit()
    return {"status": "ok", "call_id": call.id, "transcript_saved": True}


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
