from __future__ import annotations

from typing import Optional
import json
import hashlib
import time
from openai import AsyncOpenAI

from app.core.config import settings
from app.core.cache import cache_get_json, cache_set_json
from app.core.metrics import AI_LATENCY_SECONDS
from app.core.logger import logger


# ── Shared AI completion with OpenAI → Groq fallback chain ───────────────────

# Circuit breaker: once OpenAI returns 401 (bad key), skip it for the rest of this process
_openai_auth_broken = False


def _cache_key(prefix: str, payload: dict) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str)
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    return f"ai:{prefix}:{digest}"


def _is_auth_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "401" in msg or "invalid_api_key" in msg or "incorrect api key" in msg


async def _chat_completion(
    messages: list[dict],
    *,
    temperature: float = 0.5,
    max_tokens: int = 200,
    response_format: dict | None = None,
) -> str:
    """
    Try OpenAI first (unless its key is known-broken). Falls back to Groq on any failure.
    After a 401 from OpenAI, skips OpenAI for the rest of the process to avoid wasted latency.
    """
    global _openai_auth_broken

    kwargs: dict = {
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if response_format:
        kwargs["response_format"] = response_format

    # ── 1. Groq (OpenAI-compatible, ultra-fast Llama) ─────────────────────────
    if settings.GROQ_API_KEY and not settings.MOCK_SERVICES:
        try:
            start = time.perf_counter()
            groq = AsyncOpenAI(
                api_key=settings.GROQ_API_KEY,
                base_url="https://api.groq.com/openai/v1",
            )
            # Groq does not support response_format — strip it
            groq_kwargs = {k: v for k, v in kwargs.items() if k != "response_format"}
            resp = await groq.chat.completions.create(model=settings.GROQ_MODEL, **groq_kwargs)
            AI_LATENCY_SECONDS.observe(max(time.perf_counter() - start, 0.0))
            text = (resp.choices[0].message.content or "").strip()
            if text:
                logger.info("Groq succeeded")
                return text
        except Exception as exc:
            logger.warning(f"Groq failed, trying OpenAI: {exc}")

    # ── 2. OpenAI (skipped if key is known-invalid) ───────────────────────────
    if settings.OPENAI_API_KEY and not settings.MOCK_SERVICES and not _openai_auth_broken:
        try:
            start = time.perf_counter()
            client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
            resp = await client.chat.completions.create(model=settings.OPENAI_MODEL, **kwargs)
            AI_LATENCY_SECONDS.observe(max(time.perf_counter() - start, 0.0))
            text = (resp.choices[0].message.content or "").strip()
            if text:
                return text
        except Exception as exc:
            if _is_auth_error(exc):
                _openai_auth_broken = True
                logger.warning("OpenAI API key is invalid")
            else:
                logger.warning(f"OpenAI failed: {exc}")

    raise RuntimeError("Both OpenAI and Groq are unavailable")


# ── generate_screening_questions ─────────────────────────────────────────────

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
    if isinstance(cached, list) and len(cached) >= 1:
        return [str(item) for item in cached[:3]]

    first_name = full_name.split()[0] if full_name else full_name
    exp_text = f"{years_experience:g} years" if years_experience else None
    role = job_role or interest or "Software Developer"

    system = (
        "You are a warm and conversational HR screening specialist. "
        "Generate exactly 3 interview screening questions for this specific candidate. "
        "\nRULES:\n"
        "- Questions must be SPECIFIC to their exact role and experience — not generic.\n"
        f"- For a {role} role, ask about real technologies, actual challenges, and concrete outcomes they've worked on.\n"
        "- Reference their experience level naturally in the questions.\n"
        "- Each question should feel like it could ONLY be asked to this specific candidate.\n"
        "- Do NOT ask: 'What are your strengths?', 'Tell me about yourself', 'What are your top skills?'\n"
        "- Keep each question under 30 words and conversational — like a real human interviewer.\n"
        "- Return only the 3 questions, one per line, no numbers or bullets."
    )
    user = json.dumps({
        "first_name": first_name,
        "full_name": full_name,
        "email": email,
        "phone": phone,
        "job_role": role,
        "years_experience": exp_text,
        "interest": interest,
    })

    try:
        text = await _chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.72,
            max_tokens=280,
        )
        questions = [line.strip(" -•1234567890.)") for line in text.splitlines() if line.strip()]
        questions = [q for q in questions if len(q) > 10][:3]
        if questions:
            await cache_set_json(key, questions, ttl_seconds=settings.REDIS_TTL)
            return questions
    except Exception as exc:
        logger.error(f"generate_screening_questions: all AI providers failed: {exc}")

    # Absolute last resort — minimal non-question text so caller doesn't crash
    minimal = [f"Hi {first_name}, can you briefly describe your background in {role}?"]
    return minimal


MAX_SCREENING_TURNS = 4


# ── generate_opening_question ─────────────────────────────────────────────────

async def generate_opening_question(
    *,
    full_name: str,
    job_role: Optional[str],
    years_experience: Optional[float],
    interest: Optional[str],
) -> str:
    """Generate a personalised, role-specific opening question for an AI screening chat."""
    first_name = full_name.split()[0] if full_name else full_name
    exp_text = f"{years_experience:g} years" if years_experience else None

    system = (
        "You are a warm and natural HR screening specialist. "
        "You are starting a short AI screening chat with a candidate. "
        "\nYour opening message must:\n"
        "1. Greet them by first name — warm, human, brief.\n"
        "2. In one sentence, acknowledge the specific role they applied for.\n"
        "3. Ask ONE highly specific opening question tailored to their exact role and experience level — "
        "NOT a generic question like 'tell me about yourself' or 'what are your strengths'.\n"
        "   Reference their experience level naturally if relevant.\n"
        "\nRULES:\n"
        "- Under 60 words total.\n"
        "- Sound like a real human starting a conversation — not a form or a bot.\n"
        "- Do NOT say 'How are you today?' or 'Nice to meet you!' — skip pleasantries.\n"
        "- Ask exactly ONE question.\n"
        "- Do NOT reveal you are an AI.\n"
    )
    user = json.dumps({
        "first_name": first_name,
        "full_name": full_name,
        "job_role": job_role or "Software Developer",
        "years_experience": exp_text,
        "interest": interest,
    })

    try:
        result = await _chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.75,
            max_tokens=130,
        )
        if result and len(result) > 15:
            return result
    except Exception as exc:
        logger.error(f"generate_opening_question failed: {exc}")

    role = job_role or interest or "the role"
    return (
        f"Hi {first_name}, I saw your application for {role}. "
        "Can you walk me through a recent project where you had to solve a challenging technical problem?"
    )


# ── generate_next_turn ────────────────────────────────────────────────────────

async def generate_next_turn(
    *,
    full_name: str,
    job_role: Optional[str],
    years_experience: Optional[float],
    conversation_history: list[dict],
    turn_number: int,
) -> dict:
    """
    Given the full conversation so far, generate the AI's next response.

    Returns:
        {"ai_response": str, "next_question": str | None, "is_done": bool}
    """
    if not conversation_history:
        return {"ai_response": "", "next_question": None, "is_done": True}

    is_last_turn = turn_number >= MAX_SCREENING_TURNS

    transcript = "\n".join(
        f"{'Interviewer' if m['role'] == 'assistant' else 'Candidate'}: {m['content']}"
        for m in conversation_history
    )

    system = (
        "You are a warm and sharp HR specialist doing a live screening chat. "
        "Your ONLY task: read the conversation and generate your NEXT response.\n"
        "\nSTRICT RULES:\n"
        "1. ACKNOWLEDGMENT — Write 1 short sentence responding to what the candidate JUST said.\n"
        "   - Be SPECIFIC: mention something concrete they said (a technology, a number, a project).\n"
        "   - BAD examples: 'Thanks for sharing.', 'That\\'s great!', 'Interesting.'\n"
        "   - GOOD examples: 'Three years building REST APIs — solid backend experience.'\n"
        "2. NEXT QUESTION — Ask ONE question flowing DIRECTLY from what they said.\n"
        "   - Never repeat a question already asked.\n"
        "   - Never ask generic questions like 'What are your strengths?'\n"
        "3. If this is the LAST TURN (is_last=true): skip the question. Close warmly in 1-2 sentences.\n"
        "\nFORMAT — return JSON only:\n"
        '{"ai_response": "<acknowledgment only, no question>", "next_question": "<question>" or null}\n'
        "- ai_response: max 20 words\n"
        "- next_question: max 25 words, or null if last turn\n"
    )
    user = json.dumps({
        "candidate_name": full_name,
        "job_role": job_role,
        "years_experience": years_experience,
        "turn_number": turn_number,
        "is_last": is_last_turn,
        "conversation": transcript,
    })

    try:
        text = await _chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.65,
            max_tokens=220,
            response_format={"type": "json_object"},
        )
        parsed = json.loads(text)
        ai_response = str(parsed.get("ai_response", "")).strip()
        next_question = parsed.get("next_question")
        if isinstance(next_question, str):
            next_question = next_question.strip() or None

        if not ai_response:
            raise ValueError("empty ai_response")

        return {
            "ai_response": ai_response,
            "next_question": next_question if not is_last_turn else None,
            "is_done": is_last_turn or next_question is None,
        }
    except Exception as exc:
        logger.error(f"generate_next_turn failed: {exc}")
        first_name = full_name.split()[0] if full_name else full_name
        if is_last_turn:
            return {
                "ai_response": f"Thank you, {first_name}. We'll review your responses and be in touch shortly.",
                "next_question": None,
                "is_done": True,
            }
        return {
            "ai_response": "That's helpful context.",
            "next_question": "Could you tell me more about your most recent project?",
            "is_done": False,
        }


# ── generate_followup_messages ────────────────────────────────────────────────

async def generate_followup_messages(
    *,
    full_name: str,
    email: Optional[str],
    phone: str,
    job_role: Optional[str],
    years_experience: Optional[float],
    answers: list[str],
    questions: Optional[list[str]] = None,
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

    first_name = full_name.split()[0] if full_name else full_name
    position = job_role or "the role"
    if questions:
        transcript = "\n\n".join(
            f"Interviewer: {q}\nCandidate: {a}"
            for q, a in zip(questions, answers)
        )
    else:
        transcript = "\n".join(f"Response {i + 1}: {a}" for i, a in enumerate(answers) if a.strip())

    system = (
        "You are a hiring specialist. Read the candidate's screening transcript and write two personalised follow-up messages.\n"
        "SMS: Under 190 characters. Warm, specific — mention ONE concrete thing they said. End with next step.\n"
        "Email: Under 90 words. Human, not a template. Reference something specific. Make them feel seen.\n"
        "Return JSON: {\"sms\": \"...\", \"email\": \"...\"}"
    )
    user = json.dumps({
        "candidate_name": full_name,
        "first_name": first_name,
        "email": email,
        "phone": phone,
        "job_role": position,
        "years_experience": years_experience,
        "screening_transcript": transcript,
    })

    try:
        text = await _chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.5,
            max_tokens=320,
            response_format={"type": "json_object"},
        )
        parsed = json.loads(text)
        sms = str(parsed.get("sms", "")).strip()
        email_msg = str(parsed.get("email", "")).strip()
        if sms and email_msg:
            await cache_set_json(key, {"sms": sms, "email": email_msg}, ttl_seconds=settings.REDIS_TTL)
            return sms, email_msg
    except Exception as exc:
        logger.error(f"generate_followup_messages: all AI providers failed: {exc}")

    sms = f"Hi {first_name}, thank you for your screening for {position}. Our team will review your responses and reach out shortly!"
    email_msg = f"Hello {full_name},\n\nThank you for completing your screening for {position}. Our team will be in touch soon.\n\nBest regards,\n{settings.COMPANY_DESCRIPTION[:20] if settings.COMPANY_DESCRIPTION else 'Our Team'}"
    return sms, email_msg


# ── generate_call_opening ─────────────────────────────────────────────────────

async def generate_call_opening(
    *,
    full_name: str,
    interest: Optional[str],
    job_role: Optional[str],
    years_experience: Optional[float],
) -> str:
    role = job_role or interest or "your interest"
    first_name = full_name.split()[0] if full_name else full_name

    system = (
        "You are a warm outbound sales representative on a live phone call. "
        "Generate ONE natural opening line to start the conversation. "
        "Greet by first name, mention the role/interest in one sentence, then ask if it's a good time. "
        "Under 30 words. Sound human, not scripted."
    )
    user = json.dumps({
        "first_name": first_name,
        "full_name": full_name,
        "interest": interest,
        "job_role": job_role,
        "years_experience": years_experience,
    })

    try:
        return await _chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.6,
            max_tokens=80,
        )
    except Exception as exc:
        logger.error(f"generate_call_opening failed: {exc}")
        return f"Hi {first_name}, I'm calling about your interest in {role}. Is this a good time to talk?"


# ── generate_sales_call_turn ──────────────────────────────────────────────────

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
    company_description: Optional[str] = None,
    system_prompt: Optional[str] = None,
) -> str:
    history_context = ""
    if prior_questions:
        lines = []
        for i, q in enumerate(prior_questions):
            lines.append(f"  You asked: {q}")
            if prior_answers and i < len(prior_answers):
                lines.append(f"  Lead said: {prior_answers[i]}")
        history_context = "CONVERSATION SO FAR:\n" + "\n".join(lines)

    lead_parts = []
    if interest:
        lead_parts.append(f"Interest: {interest}")
    if job_role:
        lead_parts.append(f"Role: {job_role}")
    if lead_description:
        lead_parts.append(f"Background: {lead_description}")
    lead_context = "\n".join(lead_parts) or "No extra lead info."

    company_section = (
        f"## COMPANY INFO (answer ONLY from this, never invent):\n{company_description}\n\n"
        if company_description and company_description.strip()
        else ""
    )

    word_limit = 40
    if next_question:
        q_word_count = len(next_question.split())
        if q_word_count > 20:
            word_limit = q_word_count + 20
    # When a custom system_prompt is passed (e.g. for clarification answers),
    # allow more words so the AI can answer AND re-ask without being cut off.
    if system_prompt:
        word_limit = max(word_limit, 80)

    if system_prompt:
        system = (
            f"{system_prompt}\n\n"
            "STRICT OPERATIONAL GUIDELINES:\n"
            f"- You are in a live phone conversation with {full_name}.\n"
            "- Speak like a real, warm human — never robotic or scripted. Do NOT reveal you are an AI.\n"
            f"- GOAL: Acknowledge what the candidate just said, answer their question from the information, and then ask/continue the next question: {next_question or 'None'}.\n"
            f"- If they ask something outside the flow, answer briefly from company info and steer back to: {next_question or 'None'}.\n"
            f"- STYLE: Under {word_limit} words. Short natural sentences. Acknowledge first, then ask."
        )
        if closing:
            system += "\n- CLOSING NOW: Thank the candidate warmly and end the call."
    else:
        system = (
            f"You are {caller_name}, a professional sales executive at {company_name}, on a live phone call with {full_name}. "
            "Speak like a real, warm human — never robotic or scripted. Do NOT reveal you are an AI. "
            f"If asked who you are, say you are a sales rep from {company_name}.\n\n"
            f"{company_section}"
            "GOAL: answer the lead's questions from company info, confirm interest, and book a demo slot.\n"
            f"STYLE: Under {max(45, word_limit)} words. Short natural sentences. Always acknowledge what they said first.\n"
            "ANSWERING: Use ONLY the Company Info above for course/fee/duration questions. "
            f"If not in company info, say 'Our team at {company_name} will cover that in the demo.'\n"
            "BOOKING: If they give a date/time, confirm it immediately and close.\n"
            f"CLOSING: Thank {full_name} by name, confirm what was agreed, end warmly."
        )

    user = (
        f"LEAD PROFILE:\n{lead_context}\n\n"
        f"{history_context}\n\n"
        f"LEAD JUST SAID: \"{latest_candidate_response}\"\n\n"
        f"NEXT QUESTION (only if needed): {next_question or 'None — confirm booking or close.'}\n"
        f"CLOSING NOW: {'Yes' if closing else 'No'}\n\n"
        f"Respond as the sales exec. Acknowledge first, then act. Under {word_limit} words."
    )

    try:
        max_tokens_val = max(150, int(word_limit * 1.5))
        logger.info(f"AI CALL TURN: word_limit={word_limit} max_tokens={max_tokens_val} next_question={next_question}")
        res = await _chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.5,
            max_tokens=max_tokens_val,
        )
        logger.info(f"AI CALL TURN RESPONSE: {res}")
        return res
    except Exception as exc:
        logger.error(f"generate_sales_call_turn failed: {exc}")
        if closing:
            return f"Thank you so much, {full_name}! Our team at {company_name} will be in touch shortly. Have a great day!"
        return f"Got it. {next_question or f'Our team at {company_name} will reach out with the next steps.'}"


# ── generate_dynamic_next_question ───────────────────────────────────────────

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
    system = (
        f"You are {caller_name} from {company_name} on a live sales call. "
        "Generate ONE concise next question (max 20 words) to move the conversation forward. "
        "Base it DIRECTLY on what the lead just said — it must feel like a natural follow-up to THEIR response. "
        "Never repeat a question from prior_questions. "
        "Prioritise: scheduling the demo, understanding their timeline, confirming their preferred slot. "
        "Return the question only — plain text, no explanation."
    )
    user = json.dumps({
        "company_name": company_name,
        "caller_name": caller_name,
        "interest": interest,
        "job_role": job_role,
        "lead_description": lead_description,
        "latest_response": latest_candidate_response,
        "prior_answers": prior_answers or [],
        "prior_questions": prior_questions or [],
    })

    try:
        text = await _chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.5,
            max_tokens=80,
        )
        q = text.strip().rstrip(".")
        return q + "?" if "?" not in q else q
    except Exception as exc:
        logger.error(f"generate_dynamic_next_question failed: {exc}")
        return "What date and time works best for you to connect with our team?"


# ── generate_sales_cross_questions ────────────────────────────────────────────

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

    system = (
        f"You are {caller_name} from {company_name} on a live sales call. "
        f"The lead just answered: \"{candidate_response}\"\n"
        f"Generate {max_questions} short follow-up cross-questions (max 20 words each) based ONLY on what they said. "
        "Each question must feel like a natural continuation of their specific answer. "
        "Help qualify their timeline, goals, or readiness for the demo. "
        f"Return a JSON array of exactly {max_questions} question strings. No explanations."
    )
    user = json.dumps({
        "company_name": company_name,
        "caller_name": caller_name,
        "interest": interest,
        "job_role": job_role,
        "asked_question": asked_question,
        "candidate_response": candidate_response,
        "max_questions": max_questions,
    })

    try:
        text = await _chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.55,
            max_tokens=180,
            response_format={"type": "json_object"},
        )
        parsed = json.loads(text)
        # Handle both {"questions": [...]} and plain [...] responses
        if isinstance(parsed, list):
            questions = parsed
        elif isinstance(parsed, dict):
            questions = next(
                (v for v in parsed.values() if isinstance(v, list)),
                [],
            )
        else:
            questions = []
        questions = [str(q).strip() for q in questions if str(q).strip() and len(str(q)) >= 8][:max_questions]
        if questions:
            return questions
    except Exception as exc:
        logger.error(f"generate_sales_cross_questions failed: {exc}")

    # Groq failed too — try without response_format (Groq limitation workaround)
    try:
        text = await _chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.55,
            max_tokens=180,
        )
        # Try to parse JSON from plain text response
        start = text.find("[")
        end = text.rfind("]") + 1
        if start >= 0 and end > start:
            questions = json.loads(text[start:end])
            questions = [str(q).strip() for q in questions if str(q).strip() and len(str(q)) >= 8][:max_questions]
            if questions:
                return questions
        # Fallback: split by newline and clean up
        lines = [line.strip(" -•1234567890.)\"'") for line in text.splitlines() if line.strip()]
        questions = [l for l in lines if len(l) > 8][:max_questions]
        if questions:
            return questions
    except Exception as exc2:
        logger.error(f"generate_sales_cross_questions plain-text parse also failed: {exc2}")

    return [f"Could you tell me more about your availability for a demo with {company_name}?"]


# ── generate_whatsapp_reply ───────────────────────────────────────────────────

async def generate_whatsapp_reply(
    *,
    lead_name: Optional[str],
    company_name: str,
    company_description: Optional[str],
    inbound_message: str,
    conversation_history: list[dict],
) -> str:
    """Generate a contextual WhatsApp reply for an inbound message."""
    history_lines = []
    for msg in conversation_history[-10:]:
        role_label = "You" if msg.get("role") == "assistant" else "Lead"
        history_lines.append(f"{role_label}: {msg.get('content', '')}")
    history_text = "\n".join(history_lines) if history_lines else "No prior messages."

    company_section = (
        f"## COMPANY INFO (only answer from this):\n{company_description}\n\n"
        if company_description and company_description.strip()
        else ""
    )
    name = lead_name or "there"

    system = (
        f"You are a helpful WhatsApp chat agent for {company_name}. "
        f"You are chatting with {name}. "
        "Respond naturally and concisely — this is a WhatsApp chat, keep replies under 100 words. "
        "Your goal: answer their questions, qualify their interest, and guide them toward booking a demo. "
        f"{company_section}"
        "If asked about fees, courses, duration, or curriculum, answer ONLY from Company Info above. "
        f"If the info is not in Company Info, say 'Our team at {company_name} will share full details in the demo.' "
        "Never make up numbers or promises. End with a soft call-to-action toward scheduling."
    )
    user = (
        f"CONVERSATION HISTORY:\n{history_text}\n\n"
        f"LEAD JUST SENT: \"{inbound_message}\"\n\n"
        "Reply as the chat agent. Keep it conversational and under 100 words."
    )

    try:
        return await _chat_completion(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.6,
            max_tokens=180,
        )
    except Exception as exc:
        logger.error(f"generate_whatsapp_reply failed: {exc}")
        return (
            f"Hi {name}! Thanks for reaching out to {company_name}. "
            "Our team will get back to you shortly with all the details. "
            "Would you like to book a quick demo call?"
        )
