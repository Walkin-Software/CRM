from __future__ import annotations

import base64
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import Lead, User, AIScreeningSession, Call, Conversation, ConversationMessage
from app.schemas.schemas import (
    AIScreeningStartResponse,
    AIScreeningSubmitRequest,
    AIScreeningSessionOut,
)
from app.services.ai_content import generate_screening_questions, generate_followup_messages

router = APIRouter()


@router.post("/leads/{lead_id}/screening/start", response_model=AIScreeningStartResponse)
async def start_screening(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = (
        await db.execute(select(Lead).where(Lead.id == lead_id))
    ).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    questions = await generate_screening_questions(
        full_name=lead.full_name,
        email=lead.email,
        phone=lead.phone,
        job_role=lead.job_role,
        years_experience=lead.years_experience,
        interest=lead.interest,
    )

    session = AIScreeningSession(lead_id=lead.id, questions=questions, status="questions_generated")
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return AIScreeningStartResponse(session_id=session.id, questions=questions)


@router.post("/screening/{session_id}/submit", response_model=AIScreeningSessionOut)
async def submit_screening(
    session_id: str,
    payload: AIScreeningSubmitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = (
        await db.execute(select(AIScreeningSession).where(AIScreeningSession.id == session_id))
    ).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Screening session not found")

    lead = (await db.execute(select(Lead).where(Lead.id == session.lead_id))).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    audio_path = None
    if payload.audio_base64:
        storage_dir = Path("storage/recordings")
        storage_dir.mkdir(parents=True, exist_ok=True)
        ext = "webm" if "webm" in (payload.audio_mime or "") else "wav"
        file_name = f"{lead.id}_{session.id}_{uuid4().hex[:8]}.{ext}"
        target = storage_dir / file_name
        target.write_bytes(base64.b64decode(payload.audio_base64))
        audio_path = str(target)

    sms_msg, email_msg = await generate_followup_messages(
        full_name=lead.full_name,
        email=lead.email,
        phone=lead.phone,
        job_role=lead.job_role,
        years_experience=lead.years_experience,
        answers=payload.answers,
    )

    session.answers = payload.answers
    session.audio_path = audio_path
    session.ai_sms_message = sms_msg
    session.ai_email_message = email_msg
    session.status = "completed"

    call_log = Call(
        lead_id=lead.id,
        direction="inbound",
        status="completed",
        from_number=lead.phone,
        to_number="+10000000000",
        duration_seconds=120,
        recording_url=audio_path,
        handled_by="ai",
        metadata_={"type": "ai_screening", "screening_session_id": session.id},
    )
    db.add(call_log)
    await db.flush()

    # Persist full screening transcript-like data for monitoring and audit.
    conversation = Conversation(
        call_id=call_log.id,
        lead_id=lead.id,
        session_id=f"screening_{session.id}",
        summary="AI screening completed with 3 generated questions.",
        primary_intent="qualification",
        ended_at=call_log.created_at,
    )
    db.add(conversation)
    await db.flush()

    for idx, question in enumerate(session.questions):
        db.add(
            ConversationMessage(
                conversation_id=conversation.id,
                role="assistant",
                content=question,
                intent="screening_question",
                confidence=1.0,
            )
        )
        db.add(
            ConversationMessage(
                conversation_id=conversation.id,
                role="user",
                content=payload.answers[idx] if idx < len(payload.answers) else "",
                intent="screening_answer",
                confidence=1.0,
            )
        )

    await db.commit()
    await db.refresh(session)

    return AIScreeningSessionOut.model_validate(session, from_attributes=True)


@router.get("/leads/{lead_id}/screening/latest", response_model=AIScreeningSessionOut)
async def latest_screening(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = (
        await db.execute(select(Lead).where(Lead.id == lead_id))
    ).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    session = (
        await db.execute(
            select(AIScreeningSession)
            .where(AIScreeningSession.lead_id == lead_id)
            .order_by(AIScreeningSession.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="No screening session found")

    return AIScreeningSessionOut.model_validate(session, from_attributes=True)


@router.get("/monitor/sessions")
async def monitor_sessions(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(AIScreeningSession)
            .order_by(AIScreeningSession.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()

    lead_ids = [row.lead_id for row in rows]
    call_rows = (
        await db.execute(
            select(Call)
            .where(Call.lead_id.in_(lead_ids) if lead_ids else False)
            .order_by(Call.created_at.desc())
        )
    ).scalars().all()
    calls_by_lead = {}
    for call in call_rows:
        calls_by_lead.setdefault(call.lead_id, []).append(call)

    leads = (
        await db.execute(select(Lead).where(Lead.id.in_(lead_ids) if lead_ids else False))
    ).scalars().all()
    lead_map = {lead.id: lead for lead in leads}

    return {
        "items": [
            {
                "session_id": row.id,
                "lead_id": row.lead_id,
                "lead_name": lead_map.get(row.lead_id).full_name if lead_map.get(row.lead_id) else None,
                "questions": row.questions,
                "answers": row.answers,
                "audio_path": row.audio_path,
                "ai_sms_message": row.ai_sms_message,
                "ai_email_message": row.ai_email_message,
                "status": row.status,
                "created_at": row.created_at,
                "calls": [
                    {
                        "call_id": c.id,
                        "direction": c.direction,
                        "status": c.status,
                        "recording_url": c.recording_url,
                        "created_at": c.created_at,
                    }
                    for c in calls_by_lead.get(row.lead_id, [])
                ],
            }
            for row in rows
        ]
    }


@router.get("/monitor/sessions/{session_id}")
async def monitor_session_detail(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = (
        await db.execute(select(AIScreeningSession).where(AIScreeningSession.id == session_id))
    ).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Screening session not found")

    lead = (await db.execute(select(Lead).where(Lead.id == session.lead_id))).scalar_one_or_none()
    calls = (
        await db.execute(
            select(Call)
            .where(Call.lead_id == session.lead_id)
            .order_by(Call.created_at.desc())
        )
    ).scalars().all()

    conversation = (
        await db.execute(
            select(Conversation)
            .where(Conversation.session_id == f"screening_{session.id}")
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
        "session": {
            "id": session.id,
            "lead_id": session.lead_id,
            "lead_name": lead.full_name if lead else None,
            "questions": session.questions,
            "answers": session.answers,
            "audio_path": session.audio_path,
            "ai_sms_message": session.ai_sms_message,
            "ai_email_message": session.ai_email_message,
            "status": session.status,
            "created_at": session.created_at,
        },
        "calls": [
            {
                "id": c.id,
                "status": c.status,
                "recording_url": c.recording_url,
                "created_at": c.created_at,
            }
            for c in calls
        ],
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
