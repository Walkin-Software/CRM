from __future__ import annotations

from typing import Optional
import json
import hashlib
import time
from openai import AsyncOpenAI

from app.core.config import settings
from app.core.cache import cache_get_json, cache_set_json
from app.core.metrics import AI_LATENCY_SECONDS


def _cache_key(prefix: str, payload: dict) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str)
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    return f"ai:{prefix}:{digest}"


def _fallback_questions(full_name: str, job_role: Optional[str], years_experience: Optional[float]) -> list[str]:
    role = job_role or "the role you are interested in"
    exp = f"{years_experience:g}" if years_experience is not None else "your"
    return [
        f"Hi {full_name}, what motivated you to apply for {role}?",
        f"Can you share one project that best reflects your {exp} years of experience?",
        "What are your top 2 skills you want us to assess first?",
    ]


async def generate_screening_questions(
    *,
    full_name: str,
    email: Optional[str],
    phone: str,
    job_role: Optional[str],
    years_experience: Optional[float],
    interest: Optional[str],
) -> list[str]:
    cache_payload = {
        "full_name": full_name,
        "job_role": job_role,
        "years_experience": years_experience,
        "interest": interest,
    }
    key = _cache_key("screening_questions", cache_payload)
    cached = await cache_get_json(key)
    if isinstance(cached, list) and len(cached) >= 3:
        return [str(item) for item in cached[:3]]

    if settings.MOCK_SERVICES or not settings.OPENAI_API_KEY:
        fallback = _fallback_questions(full_name, job_role, years_experience)
        await cache_set_json(key, fallback, ttl_seconds=settings.REDIS_TTL)
        return fallback

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    prompt = {
        "full_name": full_name,
        "email": email,
        "phone": phone,
        "job_role": job_role,
        "years_experience": years_experience,
        "interest": interest,
    }

    try:
        start = time.perf_counter()
        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "Generate exactly 3 interview screening questions for a candidate lead. Keep each question concise and specific to role and experience.",
                },
                {"role": "user", "content": json.dumps(prompt)},
            ],
            temperature=0.4,
            max_tokens=220,
        )
        text = (response.choices[0].message.content or "").strip()
        AI_LATENCY_SECONDS.observe(max(time.perf_counter() - start, 0.0))
        questions = [line.strip(" -1234567890.") for line in text.splitlines() if line.strip()]
        questions = [q for q in questions if len(q) > 8][:3]
    except Exception:
        fallback = _fallback_questions(full_name, job_role, years_experience)
        await cache_set_json(key, fallback, ttl_seconds=settings.REDIS_TTL)
        return fallback

    if len(questions) < 3:
        fallback = _fallback_questions(full_name, job_role, years_experience)
        await cache_set_json(key, fallback, ttl_seconds=settings.REDIS_TTL)
        return fallback
    await cache_set_json(key, questions, ttl_seconds=settings.REDIS_TTL)
    return questions


def _fallback_messages(full_name: str, role: Optional[str], answers: list[str]) -> tuple[str, str]:
    position = role or "your preferred role"
    condensed = "; ".join(a.strip() for a in answers[:2] if a.strip())
    sms = f"Hi {full_name}, thanks for your responses for {position}. We reviewed: {condensed[:110]}. Our team will contact you with next steps."
    email = (
        f"Hello {full_name},\n\n"
        f"Thank you for completing your AI screening for {position}. "
        f"We have recorded your responses and our team will review your profile shortly.\n\n"
        "Regards,\nSkill Lab Admissions"
    )
    return sms, email


async def generate_followup_messages(
    *,
    full_name: str,
    email: Optional[str],
    phone: str,
    job_role: Optional[str],
    years_experience: Optional[float],
    answers: list[str],
) -> tuple[str, str]:
    cache_payload = {
        "full_name": full_name,
        "job_role": job_role,
        "years_experience": years_experience,
        "answers": answers,
    }
    key = _cache_key("followup_messages", cache_payload)
    cached = await cache_get_json(key)
    if isinstance(cached, dict) and cached.get("sms") and cached.get("email"):
        return str(cached["sms"]), str(cached["email"])

    if settings.MOCK_SERVICES or not settings.OPENAI_API_KEY:
        sms, email_msg = _fallback_messages(full_name, job_role, answers)
        await cache_set_json(key, {"sms": sms, "email": email_msg}, ttl_seconds=settings.REDIS_TTL)
        return sms, email_msg

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    prompt = {
        "full_name": full_name,
        "email": email,
        "phone": phone,
        "job_role": job_role,
        "years_experience": years_experience,
        "answers": answers,
    }

    try:
        start = time.perf_counter()
        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "Generate two outputs for candidate follow-up: 1) SMS under 220 chars, 2) professional email under 120 words. Return as JSON with keys sms and email.",
                },
                {"role": "user", "content": json.dumps(prompt)},
            ],
            temperature=0.5,
            max_tokens=280,
        )
        content = (response.choices[0].message.content or "").strip()
        AI_LATENCY_SECONDS.observe(max(time.perf_counter() - start, 0.0))
        try:
            parsed = json.loads(content)
            sms = str(parsed.get("sms", "")).strip()
            email_msg = str(parsed.get("email", "")).strip()
            if sms and email_msg:
                await cache_set_json(key, {"sms": sms, "email": email_msg}, ttl_seconds=settings.REDIS_TTL)
                return sms, email_msg
        except Exception:
            pass
    except Exception:
        sms, email_msg = _fallback_messages(full_name, job_role, answers)
        await cache_set_json(key, {"sms": sms, "email": email_msg}, ttl_seconds=settings.REDIS_TTL)
        return sms, email_msg

    sms, email_msg = _fallback_messages(full_name, job_role, answers)
    await cache_set_json(key, {"sms": sms, "email": email_msg}, ttl_seconds=settings.REDIS_TTL)
    return sms, email_msg


async def generate_call_opening(
    *,
    full_name: str,
    interest: Optional[str],
    job_role: Optional[str],
    years_experience: Optional[float],
) -> str:
    if settings.MOCK_SERVICES or not settings.OPENAI_API_KEY:
        role = job_role or interest or "your profile"
        return f"Hi {full_name}, this is Skill Lab AI assistant calling about {role}. Is this a good time for a 2-minute qualification chat?"

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    try:
        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "Create one natural outbound call opening line for a lead. Keep it under 35 words.",
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "full_name": full_name,
                            "interest": interest,
                            "job_role": job_role,
                            "years_experience": years_experience,
                        }
                    ),
                },
            ],
            temperature=0.6,
            max_tokens=90,
        )
        return (response.choices[0].message.content or "").strip()
    except Exception:
        role = job_role or interest or "your profile"
        return f"Hi {full_name}, this is Skill Lab AI assistant calling about {role}. Is this a good time for a 2-minute qualification chat?"


async def generate_sales_call_turn(
    *,
    company_name: str,
    caller_name: str,
    full_name: str,
    interest: Optional[str],
    job_role: Optional[str],
    lead_description: Optional[str],
    latest_candidate_response: str,
    next_question: Optional[str] = None,
    prior_answers: Optional[list[str]] = None,
    prior_questions: Optional[list[str]] = None,
    closing: bool = False,
) -> str:
    # Build conversation history context
    history_context = ""
    if prior_questions and prior_answers:
        history_lines = []
        for q, a in zip(prior_questions, prior_answers):
            history_lines.append(f"  - You asked: {q}")
            history_lines.append(f"    Lead answered: {a}")
        history_context = "CONVERSATION SO FAR:\n" + "\n".join(history_lines)

    # Build lead profile context
    lead_context_parts = []
    if interest:
        lead_context_parts.append(f"Interest: {interest}")
    if job_role:
        lead_context_parts.append(f"Job Role: {job_role}")
    if lead_description:
        lead_context_parts.append(f"Lead Background: {lead_description}")
    lead_context = "\n".join(lead_context_parts) if lead_context_parts else "No additional lead info available."

    system_prompt = (
        f"You are {caller_name}, a professional sales executive at {company_name}, on a live phone call with {full_name}. "
        "## IDENTITY: "
        "Speak like a real, warm, human sales rep. Never sound scripted or robotic. "
        "Do NOT reveal you are an AI or a bot under any circumstances. "
        f"If asked who you are, say you are a sales representative from {company_name}. "
        "## YOUR ONLY GOAL: "
        "Your sole purpose on this call is to confirm the lead's interest and book a demo/discussion slot. "
        "Do NOT ask about project details, required features, technical needs, outcomes, experience, or portfolio. "
        "Do NOT ask anything beyond: confirming interest, getting a preferred date/time, and wrapping up. "
        "Keep the call short, friendly, and focused on booking only. "
        "## RESPONSE STYLE: "
        "Keep every response under 40 words. "
        "Always acknowledge what the lead just said in one short natural sentence first. "
        "Then either confirm the booking, ask the next question, or close the call. "
        "Never send incomplete or broken sentences. "
        "## HANDLING LEAD QUESTIONS: "
        f"If the lead asks about the course, product, or service ({interest or 'the offering'}), "
        f"give a one-line answer like: 'Our team at {company_name} will walk you through all the details in the demo session.' "
        "Then immediately redirect to booking. "
        "Do not attempt to explain features, syllabus, curriculum, pricing, or duration in detail. "
        "## HANDLING SKIP / COMPLAINTS / FRUSTRATION: "
        "If the lead says 'skip', 'next', 'I don't want to answer', 'these are unwanted questions', or sounds frustrated, "
        "immediately apologize briefly, stop asking questions, and move to confirm the booking or close. "
        "Example: 'Apologies for that! Let me keep this quick, we'll cover everything in the demo itself.' "
        "## BOOKING CONFIRMATION: "
        "If the lead gives a date or time, confirm it immediately and warmly. "
        f"Example: 'Perfect! I've noted that. Our team at {company_name} will connect with you at that time.' "
        "Do not ask any more questions after a time is confirmed. Move to closing. "
        "## CLOSING: "
        f"{'Since closing is true: ' if closing else ''}"
        f"Thank {full_name} by name, confirm what was agreed (date/time if given), and end warmly. "
        f"Example: 'Thank you so much, {full_name}! Our team at {company_name} will connect with you soon. Have a great day!' "
    )

    user_prompt = (
        f"LEAD PROFILE:\n{lead_context}\n\n"
        f"{history_context}\n\n"
        f"LEAD'S LATEST RESPONSE: \"{latest_candidate_response}\"\n\n"
        f"NEXT QUESTION TO ASK (only if still needed): {next_question or 'None - proceed to confirm booking or close.'}\n\n"
        f"CLOSING THIS CALL: {'Yes - thank the lead and end the call.' if closing else 'No - keep moving forward.'}\n\n"
        "Now respond as the sales executive. Acknowledge the lead's response first, then act accordingly. "
        "Do not ask unnecessary questions. Keep it under 40 words."
    )

    if settings.MOCK_SERVICES or not settings.OPENAI_API_KEY:
        return _sales_turn_fallback(full_name, company_name, latest_candidate_response, next_question, closing)

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    try:
        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.5,
            max_tokens=150,
        )
        result = (response.choices[0].message.content or "").strip()
        return result if result else _sales_turn_fallback(full_name, company_name, latest_candidate_response, next_question, closing)
    except Exception:
        return _sales_turn_fallback(full_name, company_name, latest_candidate_response, next_question, closing)


def _sales_turn_fallback(
    full_name: str,
    company_name: str,
    latest_response: str,
    next_question: Optional[str],
    closing: bool,
) -> str:
    if closing:
        return f"Thank you so much, {full_name}! Our team at {company_name} will be in touch with you shortly. Have a great day!"

    raw = (latest_response or "").lower()
    info_keywords = ["what", "how", "fees", "cost", "syllabus", "curriculum", "duration", "explain", "tell me"]
    skip_keywords = ["skip", "next", "unwanted", "don't want", "not required", "move on"]

    if any(k in raw for k in skip_keywords):
        return f"Apologies for that, {full_name}! Our team at {company_name} will cover everything in the session itself. Talk soon!"

    if any(k in raw for k in info_keywords):
        return f"Great question! Our team at {company_name} will walk you through all the details in the demo. {next_question or ''}".strip()

    bridge = "Got it." if len(raw) < 10 else "Thanks for sharing."
    return f"{bridge} {next_question or f'Our team at {company_name} will be in touch shortly.'}".strip()


async def generate_dynamic_next_question(
    *,
    company_name: str,
    caller_name: str,
    interest: Optional[str],
    job_role: Optional[str],
    lead_description: Optional[str],
    latest_candidate_response: str,
    prior_answers: Optional[list[str]] = None,
    prior_questions: Optional[list[str]] = None,
) -> str:
    fallback = "What date and time would be convenient for a discussion with our team?"

    if settings.MOCK_SERVICES or not settings.OPENAI_API_KEY:
        return fallback

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    payload = {
        "company_name": company_name,
        "caller_name": caller_name,
        "interest": interest,
        "job_role": job_role,
        "lead_description": lead_description,
        "latest_candidate_response": latest_candidate_response,
        "prior_answers": prior_answers or [],
        "prior_questions": prior_questions or [],
    }

    system_prompt = (
        f"You are {caller_name} from {company_name} on a live lead call. "
        "Generate exactly ONE concise next question (max 20 words) to move the call forward. "
        "The first greeting/interest question is already done, so do not ask consent again. "
        "Use interest and lead_description context to ask relevant follow-ups. "
        "Never repeat questions from prior_questions. "
        "Do not ask interview-style questions like projects, years of experience, or portfolio. "
        "Prioritize clarity on schedule, goals, preferred focus areas, and next steps. "
        "Return plain text question only."
    )

    try:
        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(payload)},
            ],
            temperature=0.5,
            max_tokens=80,
        )
        text = (response.choices[0].message.content or "").strip()
        if text:
            return text.rstrip(".") + "?" if "?" not in text else text
    except Exception:
        pass

    return fallback


def _fallback_sales_cross_questions(
    *,
    asked_question: str,
    candidate_response: str,
    max_questions: int,
) -> list[str]:
    _ = asked_question
    response = (candidate_response or "").strip().lower()
    defaults = [
        "Could you share one practical example related to that?",
        "What outcome are you expecting from this demo?",
        "What is your preferred timeline to start after the demo?",
    ]
    if any(word in response for word in ["fresher", "no experience", "beginner"]):
        defaults = [
            "Thanks for sharing. What specific skills would you like to build first?",
            "Are you looking for beginner-friendly guidance during the demo?",
            "What is your preferred learning pace: weekday or weekend?",
        ]
    return defaults[: max(1, min(max_questions, 3))]


async def generate_sales_cross_questions(
    *,
    company_name: str,
    caller_name: str,
    interest: Optional[str],
    job_role: Optional[str],
    asked_question: str,
    candidate_response: str,
    max_questions: int = 2,
) -> list[str]:
    max_questions = max(1, min(max_questions, 3))
    if settings.MOCK_SERVICES or not settings.OPENAI_API_KEY:
        return _fallback_sales_cross_questions(
            asked_question=asked_question,
            candidate_response=candidate_response,
            max_questions=max_questions,
        )

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    payload = {
        "company_name": company_name,
        "caller_name": caller_name,
        "interest": interest,
        "job_role": job_role,
        "asked_question": asked_question,
        "candidate_response": candidate_response,
        "max_questions": max_questions,
    }

    system_prompt = (
        "Generate follow-up cross-questions for a live sales call. "
        "Return ONLY a JSON array of strings with 2 or 3 concise questions. "
        "Questions must be context-aware from candidate response and should help qualification or scheduling. "
        "No numbering, no explanations."
    )

    try:
        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(payload)},
            ],
            temperature=0.5,
            max_tokens=180,
        )
        content = (response.choices[0].message.content or "").strip()
        parsed = json.loads(content)
        if isinstance(parsed, list):
            questions = [str(item).strip() for item in parsed if str(item).strip()]
            questions = [q for q in questions if len(q) >= 8][:max_questions]
            if questions:
                return questions
    except Exception:
        pass

    return _fallback_sales_cross_questions(
        asked_question=asked_question,
        candidate_response=candidate_response,
        max_questions=max_questions,
    )
