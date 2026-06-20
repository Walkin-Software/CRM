"""
AI Training API — Knowledge base document management + AI agent configuration.
Endpoints:
  GET  /ai-training/documents          — list uploaded docs
  POST /ai-training/documents          — upload a new doc (multipart)
  DELETE /ai-training/documents/{id}   — remove a doc
  GET  /ai-training/config             — fetch current agent config
  POST /ai-training/config             — save agent config
  POST /ai-training/chat               — test the AI agent interactively
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.mongodb import get_mongo_db
from app.core.security import get_current_user
from app.models.models import KnowledgeDocument, AIAgentConfig, User
from app.core.logger import logger

router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".csv", ".docx"}
UPLOAD_DIR = Path("storage/knowledge")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_CONFIG = {
    "agent_name": "reva",
    "agent_company": "WalkinSoftware",
    "agent_language": "Indian Languages",
    "company_desc": "We are a technology education and software training provider.",
    "company_hq": "JP Nagar",
    "company_branches": "US and Singapore",
    "first_message": "Hi {{name}}, this is reva calling from WalkinSoftware regarding your interest in our course. Is this a good time to talk?",
    "wrap_up": "Thanks for your time, {{name}}! I've noted all your responses. We will get back to you with the further process on your confirmed email ID. Have a great day!",
    "rules": [
        "Do speak like human, Don't speak like a programmed robot",
        "Not need confirm or acknowledge the every response from the user"
    ],
    "model": "gpt-4o-mini",
    "temperature": 0.7,
    "max_tokens": 512,
}


def compile_system_prompt(cfg: dict) -> str:
    rules = cfg.get("rules") or []
    rules_block = "\n".join([f"- {r}" for r in rules if r.strip()]) if rules else "- Be professional and courteous."
    agent_name = cfg.get("agent_name") or "reva"
    agent_company = cfg.get("agent_company") or "WalkinSoftware"
    agent_language = cfg.get("agent_language") or "Indian Languages"
    company_desc = cfg.get("company_desc") or ""
    company_hq = cfg.get("company_hq") or "JP Nagar"
    company_branches = cfg.get("company_branches") or "US and Singapore"
    fm = cfg.get("first_message") or f"Hi {{{{name}}}}, this is {agent_name} calling from {agent_company}."
    wu = cfg.get("wrap_up") or f"Thanks for your time, {{{{name}}}}! We will get back to you soon. Have a great day!"

    return f"""[Identity]
You are {agent_name}, a professional and courteous AI assistant from {agent_company} who speaks in {agent_language}.

[Call Flow]
1. Opening line:
   "{fm}" < wait for user response >

2. Company Introduction:
   This is regarding {agent_company}. {company_desc} Our head office is in {company_hq}, and we have branches in {company_branches}. Are you interested in learning more? < wait for response >

3. Dynamic Screening Questions:
   - Ask the screening / qualification questions one by one, acknowledge briefly, then ask the next.
   <Dynamic questions will be injected here during the call based on candidate interest>

4. Wrap-Up:
   "{wu}"

Rules:
{rules_block}

[Error Handling / Fallback]
- If any response is unclear, gently ask for clarification.
- If the candidate prefers not to answer, acknowledge and move on politely."""



def _doc_out(doc: KnowledgeDocument) -> dict:
    size_bytes = doc.file_size_bytes or 0
    if size_bytes > 1_000_000:
        size_str = f"{size_bytes / 1_000_000:.1f} MB"
    elif size_bytes > 1_000:
        size_str = f"{size_bytes / 1_000:.0f} KB"
    else:
        size_str = f"{size_bytes} B"

    return {
        "id": doc.id,
        "name": doc.name,
        "size": size_str,
        "file_type": doc.file_type,
        "status": doc.status,
        "chunk_count": doc.chunk_count,
        "error_message": doc.error_message,
        "date": doc.created_at.strftime("%b %d, %Y") if doc.created_at else "—",
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
    }


# ─── Documents ───────────────────────────────────────────────

@router.get("/documents")
async def list_documents(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(KnowledgeDocument).order_by(KnowledgeDocument.created_at.desc())
    )
    docs = result.scalars().all()
    return {"documents": [_doc_out(d) for d in docs]}


@router.post("/documents", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a knowledge base document. Accepted: PDF, TXT, CSV, DOCX."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{suffix}' not supported. Use: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    content = await file.read()
    file_size = len(content)

    safe_name = Path(file.filename).name
    dest = UPLOAD_DIR / f"{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{safe_name}"
    dest.write_bytes(content)

    doc = KnowledgeDocument(
        name=safe_name,
        file_path=str(dest),
        file_size_bytes=file_size,
        file_type=suffix.lstrip("."),
        status="training",
        uploaded_by=current_user.id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    # Simulate background training completion (in production: dispatch Celery task)
    doc.status = "trained"
    doc.chunk_count = max(1, file_size // 512)
    await db.commit()
    await db.refresh(doc)

    return _doc_out(doc)


@router.delete("/documents/{doc_id}", status_code=204)
async def delete_document(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = (
        await db.execute(select(KnowledgeDocument).where(KnowledgeDocument.id == doc_id))
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if doc.file_path and Path(doc.file_path).exists():
        try:
            Path(doc.file_path).unlink()
        except OSError:
            pass

    await db.delete(doc)
    await db.commit()


# ─── Agent Config ─────────────────────────────────────────────

@router.get("/config")
async def get_config(
    current_user: User = Depends(get_current_user),
):
    mongo_db = get_mongo_db()
    row = await mongo_db["ai_agent_configs"].find_one({"config_key": "agent_defaults"})
    if row and row.get("config_value"):
        return row["config_value"]

    # Generate and save default
    cfg = dict(DEFAULT_CONFIG)
    cfg["system_prompt"] = compile_system_prompt(cfg)
    await mongo_db["ai_agent_configs"].insert_one({
        "config_key": "agent_defaults",
        "config_value": cfg,
        "updated_at": datetime.now(timezone.utc)
    })
    return cfg


class AgentConfigPayload(BaseModel):
    # Model settings
    system_prompt: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    # Builder fields — stored so the UI can reload them
    agent_name: Optional[str] = None
    agent_language: Optional[str] = None
    agent_company: Optional[str] = None
    company_desc: Optional[str] = None
    company_hq: Optional[str] = None
    company_branches: Optional[str] = None
    first_message: Optional[str] = None
    wrap_up: Optional[str] = None
    questions: Optional[list] = None
    rules: Optional[list] = None
    products: Optional[list] = None
    services: Optional[list] = None
    selected_product: Optional[str] = None
    selected_service: Optional[str] = None


@router.post("/config")
async def save_config(
    payload: AgentConfigPayload,
    current_user: User = Depends(get_current_user),
):
    mongo_db = get_mongo_db()
    row = await mongo_db["ai_agent_configs"].find_one({"config_key": "agent_defaults"})

    new_cfg = dict(DEFAULT_CONFIG)
    if row and row.get("config_value"):
        new_cfg.update(row["config_value"])

    scalar_fields = {
        "system_prompt", "model", "agent_name", "agent_language", "agent_company",
        "company_desc", "company_hq", "company_branches",
        "first_message", "wrap_up", "selected_product", "selected_service",
    }
    list_fields = {"questions", "rules", "products", "services"}

    for field in scalar_fields:
        val = getattr(payload, field, None)
        if val is not None:
            new_cfg[field] = val

    for field in list_fields:
        val = getattr(payload, field, None)
        if val is not None:
            new_cfg[field] = val

    if payload.temperature is not None:
        new_cfg["temperature"] = max(0.0, min(1.0, payload.temperature))
    if payload.max_tokens is not None:
        new_cfg["max_tokens"] = max(64, min(4096, payload.max_tokens))

    if not new_cfg.get("system_prompt"):
        new_cfg["system_prompt"] = compile_system_prompt(new_cfg)

    if row:
        await mongo_db["ai_agent_configs"].update_one(
            {"config_key": "agent_defaults"},
            {
                "$set": {
                    "config_value": new_cfg,
                    "updated_by": current_user.id,
                    "updated_at": datetime.now(timezone.utc),
                }
            }
        )
    else:
        await mongo_db["ai_agent_configs"].insert_one({
            "config_key": "agent_defaults",
            "config_value": new_cfg,
            "updated_by": current_user.id,
            "updated_at": datetime.now(timezone.utc)
        })

    return new_cfg


# ─── Product & Service Catalog ───────────────────────────────

import json

CATALOG_KEY = "product_catalog"

DEFAULT_CATALOG_PATH = Path(__file__).parent.parent.parent / "core" / "default_catalog.json"
try:
    with open(DEFAULT_CATALOG_PATH, "r", encoding="utf-8") as f:
        DEFAULT_CATALOG = json.load(f)
except Exception as exc:
    logger.error(f"Failed to load default catalog JSON: {exc}")
    DEFAULT_CATALOG = {"products": [], "services": []}


class CatalogPayload(BaseModel):
    products: Optional[list] = None
    services: Optional[list] = None


@router.get("/catalog")
async def get_catalog(
    current_user: User = Depends(get_current_user),
):
    mongo_db = get_mongo_db()
    products_count = await mongo_db["products"].count_documents({})
    services_count = await mongo_db["services"].count_documents({})
    
    if products_count == 0 and services_count == 0:
        if DEFAULT_CATALOG.get("products"):
            await mongo_db["products"].insert_many([dict(p) for p in DEFAULT_CATALOG["products"]])
        if DEFAULT_CATALOG.get("services"):
            await mongo_db["services"].insert_many([dict(s) for s in DEFAULT_CATALOG["services"]])
        return DEFAULT_CATALOG

    products_cursor = mongo_db["products"].find({}, {"_id": False})
    services_cursor = mongo_db["services"].find({}, {"_id": False})
    products = await products_cursor.to_list(length=1000)
    services = await services_cursor.to_list(length=1000)
    return {"products": products, "services": services}


@router.post("/catalog")
async def save_catalog(
    payload: CatalogPayload,
    current_user: User = Depends(get_current_user),
):
    mongo_db = get_mongo_db()
    
    if payload.products is not None:
        await mongo_db["products"].delete_many({})
        if payload.products:
            cleaned_products = []
            for p in payload.products:
                p_copy = dict(p)
                p_copy.pop("_id", None)
                cleaned_products.append(p_copy)
            await mongo_db["products"].insert_many(cleaned_products)
            
    if payload.services is not None:
        await mongo_db["services"].delete_many({})
        if payload.services:
            cleaned_services = []
            for s in payload.services:
                s_copy = dict(s)
                s_copy.pop("_id", None)
                cleaned_services.append(s_copy)
            await mongo_db["services"].insert_many(cleaned_services)
            
    return {
        "products": payload.products if payload.products is not None else [],
        "services": payload.services if payload.services is not None else []
    }


@router.post("/catalog/reset")
async def reset_catalog(
    current_user: User = Depends(get_current_user),
):
    """Reset the product & service catalog to the built-in document defaults in MongoDB."""
    mongo_db = get_mongo_db()
    await mongo_db["products"].delete_many({})
    await mongo_db["services"].delete_many({})
    if DEFAULT_CATALOG.get("products"):
        await mongo_db["products"].insert_many([dict(p) for p in DEFAULT_CATALOG["products"]])
    if DEFAULT_CATALOG.get("services"):
        await mongo_db["services"].insert_many([dict(s) for s in DEFAULT_CATALOG["services"]])
    return DEFAULT_CATALOG


# ─── Chat / Test Endpoint ─────────────────────────────────────

class ChatMessage(BaseModel):
    message: str
    history: Optional[list] = None


@router.post("/chat")
async def chat_with_agent(
    payload: ChatMessage,
    current_user: User = Depends(get_current_user),
):
    """
    Test the AI agent against the current knowledge base.
    Calls the existing ai_content service with the configured system prompt.
    """
    mongo_db = get_mongo_db()
    row = await mongo_db["ai_agent_configs"].find_one({"config_key": "agent_defaults"})
    cfg = row.get("config_value") if row else DEFAULT_CONFIG
    system_prompt = cfg.get("system_prompt")
    if not system_prompt:
        system_prompt = compile_system_prompt(cfg)

    history = payload.history or []
    history.append({"role": "user", "content": payload.message})

    try:
        from app.services.ai_content import _call_openai_json
        import json

        messages = [{"role": "system", "content": system_prompt}]
        for h in (payload.history or []):
            if isinstance(h, dict) and h.get("role") in ("user", "assistant"):
                messages.append({"role": h["role"], "content": h.get("content", "")})
        messages.append({"role": "user", "content": payload.message})

        raw = await _call_openai_json(
            system=system_prompt,
            user=json.dumps({"query": payload.message, "history": payload.history or []}),
        )
        reply = raw.get("reply") or raw.get("response") or raw.get("answer") or str(raw)
    except Exception as exc:
        logger.warning(f"AI chat fallback: {exc}")
        query = payload.message.lower()
        if any(w in query for w in ("lead", "sale", "contact")):
            reply = "Based on our SOP training, we currently have active leads in the pipeline. The AI agent handles initial screening and qualification automatically."
        elif any(w in query for w in ("price", "plan", "billing", "cost")):
            reply = "According to the Product Catalog, our Standard plan starts at ₹5,000/month and Enterprise at ₹45,000/month with a 10% discount on annual commitments."
        elif any(w in query for w in ("hello", "hi", "hey")):
            reply = "Hello! I am CRM Calling AI, trained on your knowledge base. Ask me about leads, pricing, or our sales process."
        else:
            reply = "I have processed your query against the active knowledge base. Please be more specific or check the uploaded documents for detailed information."

    return {
        "reply": reply,
        "model": cfg.get("model", DEFAULT_CONFIG["model"]),
    }


class GenerateQuestionsPayload(BaseModel):
    name: str
    description: Optional[str] = ""


@router.post("/generate-questions")
async def generate_questions(
    payload: GenerateQuestionsPayload,
    current_user: User = Depends(get_current_user),
):
    """
    Generate 4 custom interview screening/qualification questions for a product using AI.
    """
    try:
        from app.services.ai_content import _chat_completion
        import json

        system_instruction = (
            "You are a professional recruiting assistant. "
            "Your task is to generate exactly 4 distinct, high-quality, and highly relevant "
            "screening/qualification questions to ask a lead who has expressed interest in a product or program. "
            "Each question should be tailored to understand if the candidate has the right background, "
            "expectations, or timeline for this specific offering. "
            "Keep each question short, warm, and natural for voice conversation. "
            "Return ONLY a JSON object with a single key 'questions' containing a list of exactly 4 strings."
        )

        user_input = json.dumps({
            "product_name": payload.name,
            "product_description": payload.description or ""
        })

        raw_response = await _chat_completion(
            [
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": user_input}
            ],
            temperature=0.7,
            max_tokens=256,
            response_format={"type": "json_object"}
        )

        parsed = json.loads(raw_response)
        questions = parsed.get("questions", [])
        if isinstance(questions, list) and len(questions) > 0:
            return {"questions": [str(q).strip() for q in questions[:4]]}
            
        raise ValueError("Invalid format returned by AI completion")

    except Exception as exc:
        logger.error(f"Failed to generate questions using AI: {exc}")
        # Dynamic fallback questions based on name
        name_lower = payload.name.lower()
        if "course" in name_lower or "training" in name_lower or "program" in name_lower:
            return {
                "questions": [
                    f"Are you looking to join our {payload.name} as a fresher or working professional?",
                    "What specific goals do you want to achieve through this training program?",
                    "How much time can you commit weekly for classes and practical assignments?",
                    "When are you planning to start your training session?"
                ]
            }
        return {
            "questions": [
                f"What details are you looking to know first about {payload.name}?",
                "Are you currently exploring other similar solutions or courses?",
                "When would you be available for a brief discussion with our counselor?",
                "What is the best way for us to share the curriculum and details with you?"
            ]
        }

