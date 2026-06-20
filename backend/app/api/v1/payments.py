"""
Stripe Payments API — create payment intents, handle webhooks, list transactions.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.config import settings
from app.core.logger import logger
from app.models.models import User, Lead, Transaction
from app.schemas.schemas import PaginatedResponse

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _stripe_client():
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status_code=500, detail="Stripe is not configured (STRIPE_SECRET_KEY missing)")
    import stripe
    stripe.api_key = settings.STRIPE_SECRET_KEY
    return stripe


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreatePaymentIntentRequest(BaseModel):
    lead_id: str
    amount_inr: float
    description: Optional[str] = None
    metadata: Optional[dict] = None


class TransactionOut(BaseModel):
    id: str
    lead_id: Optional[str]
    amount_cents: int
    currency: str
    status: str
    payment_method: Optional[str]
    stripe_payment_intent_id: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/create-intent")
async def create_payment_intent(
    payload: CreatePaymentIntentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a Stripe PaymentIntent for a lead and save a pending Transaction."""
    lead = (await db.execute(select(Lead).where(Lead.id == payload.lead_id))).scalar_one_or_none()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    amount_cents = int(round(payload.amount_inr * 100))
    if amount_cents < 50:
        raise HTTPException(status_code=400, detail="Minimum amount is ₹0.50")

    intent_id: str | None = None
    client_secret: str | None = None

    if not settings.MOCK_SERVICES and settings.STRIPE_SECRET_KEY:
        try:
            stripe = _stripe_client()
            intent = stripe.PaymentIntent.create(
                amount=amount_cents,
                currency="inr",
                description=payload.description or f"Payment for lead {lead.full_name}",
                metadata={
                    "lead_id": lead.id,
                    "lead_name": lead.full_name,
                    **(payload.metadata or {}),
                },
                automatic_payment_methods={"enabled": True},
            )
            intent_id = intent["id"]
            client_secret = intent["client_secret"]
        except Exception as exc:
            logger.error(f"Stripe PaymentIntent creation failed for lead={lead.id}: {exc}")
            raise HTTPException(status_code=502, detail=f"Stripe error: {exc}")
    else:
        intent_id = f"mock_pi_{int(datetime.now(timezone.utc).timestamp())}"
        client_secret = f"{intent_id}_secret_mock"

    txn = Transaction(
        lead_id=lead.id,
        stripe_payment_intent_id=intent_id,
        amount_cents=amount_cents,
        currency="INR",
        status="pending",
        metadata_={"description": payload.description, **(payload.metadata or {})},
    )
    db.add(txn)
    await db.commit()
    await db.refresh(txn)

    return {
        "transaction_id": txn.id,
        "payment_intent_id": intent_id,
        "client_secret": client_secret,
        "amount_inr": payload.amount_inr,
        "currency": "INR",
        "status": "pending",
        "mock": settings.MOCK_SERVICES,
    }


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="stripe-signature"),
    db: AsyncSession = Depends(get_db),
):
    """Handle Stripe webhook events — update transaction status."""
    body = await request.body()

    event = None
    if settings.STRIPE_WEBHOOK_SECRET and stripe_signature and not settings.MOCK_SERVICES:
        try:
            stripe = _stripe_client()
            event = stripe.Webhook.construct_event(body, stripe_signature, settings.STRIPE_WEBHOOK_SECRET)
        except Exception as exc:
            logger.warning(f"Stripe webhook signature verification failed: {exc}")
            raise HTTPException(status_code=400, detail="Invalid webhook signature")
    else:
        try:
            event = json.loads(body)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type = event.get("type", "")
    data_obj = (event.get("data") or {}).get("object") or {}

    intent_id = data_obj.get("id")
    if not intent_id:
        return {"status": "ignored", "reason": "no_intent_id"}

    txn = (
        await db.execute(select(Transaction).where(Transaction.stripe_payment_intent_id == intent_id))
    ).scalar_one_or_none()

    if not txn:
        return {"status": "ignored", "reason": "transaction_not_found"}

    status_map = {
        "payment_intent.succeeded":               "completed",
        "payment_intent.payment_failed":          "failed",
        "payment_intent.canceled":                "failed",
        "payment_intent.requires_payment_method": "pending",
        "charge.refunded":                        "refunded",
    }

    new_status = status_map.get(event_type)
    if new_status:
        txn.status = new_status
        if new_status == "completed":
            # Update lead status to converted
            if txn.lead_id:
                lead = (await db.execute(select(Lead).where(Lead.id == txn.lead_id))).scalar_one_or_none()
                if lead and lead.status not in {"converted"}:
                    lead.status = "converted"
        await db.commit()
        logger.info(f"Stripe webhook: intent={intent_id} event={event_type} → txn status={new_status}")

    return {"status": "ok", "transaction_id": txn.id, "event_type": event_type}


@router.get("/transactions", response_model=PaginatedResponse)
async def list_transactions(
    page: int = 1,
    page_size: int = 20,
    lead_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all payment transactions with optional lead filter."""
    q = select(Transaction)
    if lead_id:
        q = q.where(Transaction.lead_id == lead_id)

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (
        await db.execute(q.order_by(Transaction.created_at.desc()).offset((page - 1) * page_size).limit(page_size))
    ).scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": t.id,
                "lead_id": t.lead_id,
                "amount_cents": t.amount_cents,
                "currency": t.currency,
                "status": t.status,
                "payment_method": t.payment_method,
                "stripe_payment_intent_id": t.stripe_payment_intent_id,
                "created_at": t.created_at,
            }
            for t in rows
        ],
    }


@router.get("/transactions/{transaction_id}")
async def get_transaction(
    transaction_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    txn = (await db.execute(select(Transaction).where(Transaction.id == transaction_id))).scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return txn


# ── Frontend-compatible aliases ───────────────────────────────────────────────

class CheckoutRequest(BaseModel):
    lead_id: str
    amount_inr: float
    description: Optional[str] = None


@router.post("/checkout")
async def checkout(
    payload: CheckoutRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Alias for /create-intent — used by the frontend paymentsAPI.checkout()."""
    return await create_payment_intent(
        CreatePaymentIntentRequest(
            lead_id=payload.lead_id,
            amount_inr=payload.amount_inr,
            description=payload.description,
        ),
        db=db,
        current_user=current_user,
    )


class RefundRequest(BaseModel):
    transaction_id: str
    amount_inr: Optional[float] = None
    reason: Optional[str] = None


@router.post("/refund")
async def refund_payment(
    payload: RefundRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Issue a full or partial refund for a completed transaction."""
    txn = (await db.execute(select(Transaction).where(Transaction.id == payload.transaction_id))).scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if txn.status not in {"completed"}:
        raise HTTPException(status_code=400, detail=f"Cannot refund a transaction with status '{txn.status}'")

    refund_cents = int(round((payload.amount_inr or txn.amount_cents / 100) * 100))
    if refund_cents > txn.amount_cents:
        raise HTTPException(status_code=400, detail="Refund amount exceeds original payment")

    if not settings.MOCK_SERVICES and settings.STRIPE_SECRET_KEY and txn.stripe_payment_intent_id:
        try:
            stripe = _stripe_client()
            stripe.Refund.create(
                payment_intent=txn.stripe_payment_intent_id,
                amount=refund_cents,
                reason="requested_by_customer",
            )
        except Exception as exc:
            logger.error(f"Stripe refund failed for txn={txn.id}: {exc}")
            raise HTTPException(status_code=502, detail=f"Stripe error: {exc}")

    txn.refund_amount_cents = refund_cents
    txn.refunded_at = datetime.now(timezone.utc)
    txn.status = "refunded" if refund_cents >= txn.amount_cents else "partially_refunded"
    await db.commit()
    await db.refresh(txn)

    return {
        "transaction_id": txn.id,
        "refund_amount_inr": refund_cents / 100,
        "status": txn.status,
        "mock": settings.MOCK_SERVICES,
    }

