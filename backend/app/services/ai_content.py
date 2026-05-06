from __future__ import annotations

from typing import Optional
import json
from openai import AsyncOpenAI

from app.core.config import settings


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
    if settings.MOCK_SERVICES or not settings.OPENAI_API_KEY:
        return _fallback_questions(full_name, job_role, years_experience)

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
        questions = [line.strip(" -1234567890.") for line in text.splitlines() if line.strip()]
        questions = [q for q in questions if len(q) > 8][:3]
    except Exception:
        return _fallback_questions(full_name, job_role, years_experience)

    if len(questions) < 3:
        return _fallback_questions(full_name, job_role, years_experience)
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
    if settings.MOCK_SERVICES or not settings.OPENAI_API_KEY:
        return _fallback_messages(full_name, job_role, answers)

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
        try:
            parsed = json.loads(content)
            sms = str(parsed.get("sms", "")).strip()
            email_msg = str(parsed.get("email", "")).strip()
            if sms and email_msg:
                return sms, email_msg
        except Exception:
            pass
    except Exception:
        return _fallback_messages(full_name, job_role, answers)

    return _fallback_messages(full_name, job_role, answers)


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
    latest_candidate_response: str,
    next_question: Optional[str] = None,
    prior_answers: Optional[list[str]] = None,
    closing: bool = False,
) -> str:
    fallback = (
        f"Thank you for your time, {full_name}. Our team at {company_name} will review your responses and get back to you soon."
        if closing
        else f"Thank you for your answer. {next_question}"
    )

    if settings.MOCK_SERVICES or not settings.OPENAI_API_KEY:
        return fallback

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    payload = {
        "company_name": company_name,
        "caller_name": caller_name,
        "full_name": full_name,
        "interest": interest,
        "job_role": job_role,
        "latest_candidate_response": latest_candidate_response,
        "next_question": next_question,
        "prior_answers": prior_answers or [],
        "closing": closing,
    }

    system_prompt = (
        f"You are {caller_name}, a concise and professional sales executive from {company_name}. "
        "You are speaking on a phone call with a lead. "
        "If the lead asks something, briefly answer it naturally, then smoothly move the call forward. "
        "Keep the response under 45 words. "
        "If closing is true, thank the lead warmly and end the call."
    )

    try:
        response = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(payload)},
            ],
            temperature=0.5,
            max_tokens=140,
        )
        content = (response.choices[0].message.content or "").strip()
        return content or fallback
    except Exception:
        return fallback
