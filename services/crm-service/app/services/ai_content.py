from __future__ import annotations

import json
from typing import Optional
from openai import AsyncOpenAI

from app.core.config import settings

AI_NAME = "Alex"
COMPANY_NAME = "Walkin Software"
MAX_SCREENING_TURNS = 4


def _client() -> AsyncOpenAI:
    return AsyncOpenAI(api_key=settings.OPENAI_API_KEY)


# ── Opening question ──────────────────────────────────────────────────────────

async def generate_opening_question(
    *,
    full_name: str,
    job_role: Optional[str],
    years_experience: Optional[float],
    interest: Optional[str],
) -> str:
    first_name = full_name.split()[0] if full_name else full_name
    exp_text = f"{years_experience:g} years" if years_experience else None

    system = (
        f"You are {AI_NAME}, a warm and natural HR screening specialist at {COMPANY_NAME}. "
        "You are starting a short AI screening chat with a candidate. "
        "\nYour opening message must:\n"
        f"1. Greet them by first name — warm, human, brief.\n"
        "2. In one sentence, acknowledge the specific role they applied for.\n"
        "3. Ask ONE highly specific opening question tailored to their exact role and experience level — "
        "NOT a generic question like 'tell me about yourself' or 'what are your strengths'.\n"
        "   - For a Python dev: ask about a specific framework, deployment challenge, or codebase they've worked on.\n"
        "   - For a data engineer: ask about a pipeline they built, a data quality issue they solved.\n"
        "   - For a Java dev: ask about a service architecture or a performance problem they tackled.\n"
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
        resp = await _client().chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.75,
            max_tokens=130,
        )
        result = (resp.choices[0].message.content or "").strip()
        if result and len(result) > 15:
            return result
    except Exception as exc:
        raise RuntimeError(f"OpenAI failed to generate opening question: {exc}") from exc

    raise RuntimeError("OpenAI returned an empty response for the opening question.")


# ── Turn-by-turn response ─────────────────────────────────────────────────────

async def generate_next_turn(
    *,
    full_name: str,
    job_role: Optional[str],
    years_experience: Optional[float],
    conversation_history: list[dict],
    turn_number: int,
) -> dict:
    """
    Given the full conversation so far, generate the AI's next response from OpenAI.

    conversation_history: [{"role": "assistant", "content": "..."}, {"role": "user", "content": "..."}, ...]

    Returns:
        {
            "ai_response": str,           # specific acknowledgment of what candidate just said
            "next_question": str | None,  # follow-up question, or null if screening is done
            "is_done": bool,
        }
    """
    if not conversation_history:
        return {"ai_response": "", "next_question": None, "is_done": True}

    is_last_turn = turn_number >= MAX_SCREENING_TURNS

    transcript = "\n".join(
        f"{'Interviewer' if m['role'] == 'assistant' else 'Candidate'}: {m['content']}"
        for m in conversation_history
    )

    system = (
        f"You are {AI_NAME}, a warm and sharp HR specialist at {COMPANY_NAME} doing a live screening chat. "
        "\nYour ONLY task: read the conversation and generate your NEXT response.\n"
        "\nSTRICT RULES:\n"
        "1. ACKNOWLEDGMENT — Write 1 short sentence responding to what the candidate JUST said.\n"
        "   - Be SPECIFIC: mention something concrete they said (a technology, a number, a project, a company, an action).\n"
        "   - BAD examples (too generic): 'Thanks for sharing.', 'That's great!', 'Interesting.'\n"
        "   - GOOD examples: 'Three years building REST APIs in Django — that's solid backend experience.'\n"
        "     'Migrating a monolith to microservices is genuinely complex — respect for that.'\n"
        "     'Working directly with clients on requirements changes how you think about architecture.'\n"
        "2. NEXT QUESTION — Ask ONE question that flows DIRECTLY from what they said.\n"
        "   - Dig deeper into something they mentioned, OR naturally move to the next important topic.\n"
        "   - Never repeat a question already asked.\n"
        "   - Never ask generic questions like 'What are your strengths?' or 'Where do you see yourself in 5 years?'\n"
        "   - The question should feel like it could ONLY be asked to THIS specific person based on THEIR answer.\n"
        "3. If this is the LAST TURN (is_last=true): skip the question. Close warmly in 1-2 sentences.\n"
        "   Reference something real and specific from the conversation in your closing.\n"
        "\nFORMAT — return JSON only:\n"
        '{"ai_response": "<acknowledgment only, no question here>", "next_question": "<question string>" or null}\n'
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
        resp = await _client().chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.65,
            max_tokens=220,
            response_format={"type": "json_object"},
        )
        content = (resp.choices[0].message.content or "").strip()
        parsed = json.loads(content)
        ai_response = str(parsed.get("ai_response", "")).strip()
        next_question = parsed.get("next_question")
        if isinstance(next_question, str):
            next_question = next_question.strip() or None

        if not ai_response:
            raise ValueError("OpenAI returned empty ai_response")

        return {
            "ai_response": ai_response,
            "next_question": next_question if not is_last_turn else None,
            "is_done": is_last_turn or next_question is None,
        }
    except Exception as exc:
        # Re-raise so the API endpoint can return a proper error instead of serving static content
        raise RuntimeError(f"OpenAI failed to generate next turn: {exc}") from exc


# ── Follow-up messages ────────────────────────────────────────────────────────

async def generate_followup_messages(
    *,
    full_name: str,
    email: Optional[str],  # noqa: kept for API signature
    phone: str,  # noqa: kept for API signature
    job_role: Optional[str],
    years_experience: Optional[float],
    answers: list[str],
    questions: Optional[list[str]] = None,
) -> tuple[str, str]:
    """Generate personalised SMS + email using the actual conversation transcript."""
    first_name = full_name.split()[0] if full_name else full_name

    if questions:
        transcript = "\n\n".join(
            f"Interviewer: {q}\nCandidate: {a}"
            for q, a in zip(questions, answers)
        )
    else:
        transcript = "\n\n".join(f"Response {i + 1}: {a}" for i, a in enumerate(answers))

    system = (
        f"You are a hiring specialist at {COMPANY_NAME}. "
        "Read the candidate's screening transcript and write two personalised follow-up messages.\n"
        "\nSMS rules:\n"
        "- Under 190 characters.\n"
        "- Warm, specific — mention ONE concrete detail from their transcript.\n"
        "- End with a clear next step.\n"
        "\nEmail rules:\n"
        "- Under 90 words.\n"
        "- Professional but human — not a template.\n"
        "- Reference something specific they said — make them feel seen, not processed.\n"
        "\nReturn JSON only: {\"sms\": \"...\", \"email\": \"...\"}"
    )

    user = json.dumps({
        "candidate_name": full_name,
        "first_name": first_name,
        "job_role": job_role,
        "years_experience": years_experience,
        "screening_transcript": transcript,
    })

    try:
        resp = await _client().chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.5,
            max_tokens=350,
            response_format={"type": "json_object"},
        )
        content = (resp.choices[0].message.content or "").strip()
        parsed = json.loads(content)
        sms = str(parsed.get("sms", "")).strip()
        email_msg = str(parsed.get("email", "")).strip()
        if sms and email_msg:
            return sms, email_msg
        raise ValueError("OpenAI returned incomplete sms/email fields")
    except Exception as exc:
        raise RuntimeError(f"OpenAI failed to generate follow-up messages: {exc}") from exc


# ── Legacy shim — existing /screening/start endpoint continues to work ─────────

async def generate_screening_questions(
    *,
    full_name: str,
    email: Optional[str],  # noqa
    phone: str,  # noqa
    job_role: Optional[str],
    years_experience: Optional[float],
    interest: Optional[str],
) -> list[str]:
    opening = await generate_opening_question(
        full_name=full_name,
        job_role=job_role,
        years_experience=years_experience,
        interest=interest,
    )
    return [opening]
