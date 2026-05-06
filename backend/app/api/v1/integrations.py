from __future__ import annotations

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import User, Lead
from app.schemas.schemas import LeadOut

router = APIRouter()


def _sample_scraped_leads() -> list[dict]:
    return [
        {
            "full_name": "Arjun Sharma",
            "phone": "+919100000001",
            "email": "arjun.google@example.com",
            "interest": "Full Stack",
            "source": "social_media",
            "lead_type": "call",
            "job_role": "Frontend Developer",
            "years_experience": 2.0,
        },
        {
            "full_name": "Nisha Verma",
            "phone": "+919100000002",
            "email": "nisha.insta@example.com",
            "interest": "Data Science",
            "source": "social_media",
            "lead_type": "dm",
            "job_role": "Data Analyst",
            "years_experience": 1.5,
        },
        {
            "full_name": "Rahul Menon",
            "phone": "+919100000003",
            "email": "rahul.fb@example.com",
            "interest": "DevOps",
            "source": "social_media",
            "lead_type": "form",
            "job_role": "DevOps Engineer",
            "years_experience": 3.0,
        },
        {
            "full_name": "Simran Kaur",
            "phone": "+919100000004",
            "email": "simran.yt@example.com",
            "interest": "Placement Program",
            "source": "web_form",
            "lead_type": "form",
            "job_role": "Backend Developer",
            "years_experience": 0.0,
        },
    ]


@router.post("/scrape/sample", response_model=list[LeadOut])
async def import_sample_scraped_leads(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    created: list[Lead] = []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    for data in _sample_scraped_leads():
        existing = (
            await db.execute(
                select(Lead)
                .where(Lead.phone == data["phone"])
                .where(Lead.created_at >= cutoff)
                .order_by(Lead.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if existing:
            created.append(existing)
            continue

        lead = Lead(
            full_name=data["full_name"],
            phone=data["phone"],
            email=data["email"],
            interest=data["interest"],
            source=data["source"],
            lead_type=data["lead_type"],
            job_role=data["job_role"],
            years_experience=data["years_experience"],
            status="new",
        )
        db.add(lead)
        created.append(lead)

    await db.commit()
    for lead in created:
        await db.refresh(lead)

    return [LeadOut.model_validate(lead, from_attributes=True) for lead in created]
