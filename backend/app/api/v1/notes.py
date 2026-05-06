"""
Notes API — Lead-scoped notes (CRUD)
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.models import Lead, LeadNote, User
from app.schemas.schemas import NoteCreate, NoteOut

router = APIRouter()


@router.post("/{lead_id}/notes", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
async def add_note(
    lead_id: str,
    payload: NoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add a note to a lead."""
    lead = await db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")

    note = LeadNote(lead_id=lead_id, author_id=current_user.id, content=payload.content)
    db.add(note)
    await db.flush()
    await db.refresh(note, ["author"])
    return NoteOut.model_validate(note, from_attributes=True)


@router.get("/{lead_id}/notes", response_model=list[NoteOut])
async def get_notes(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all notes for a lead."""
    result = await db.execute(
        select(LeadNote)
        .where(LeadNote.lead_id == lead_id)
        .options(selectinload(LeadNote.author))
        .order_by(LeadNote.created_at.desc())
    )
    return [NoteOut.model_validate(n, from_attributes=True) for n in result.scalars().all()]


@router.delete("/{lead_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    lead_id: str,
    note_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(LeadNote).where(LeadNote.id == note_id, LeadNote.lead_id == lead_id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")
    # Only admin or author can delete
    if current_user.role.name != "admin" and note.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not allowed.")
    await db.delete(note)
