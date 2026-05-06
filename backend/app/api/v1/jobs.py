from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List

from app.core.database import get_db
from app.models.models import JobPosting, JobApplication, Student
from pydantic import BaseModel

router = APIRouter()

class JobCreate(BaseModel):
    company_name: str
    role: str
    required_skills: list[str] = []
    salary_range: str | None = None
    location: str | None = None

class ApplicationCreate(BaseModel):
    student_id: str

@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_job(payload: JobCreate, db: AsyncSession = Depends(get_db)):
    """Step 7a: Job Posting System"""
    new_job = JobPosting(
        company_name=payload.company_name,
        role=payload.role,
        required_skills=payload.required_skills,
        salary_range=payload.salary_range,
        location=payload.location,
        status="published", # auto publish for immediate matching
        is_approved=True
    )
    db.add(new_job)
    await db.commit()
    await db.refresh(new_job)
    return new_job

@router.post("/{job_id}/apply", status_code=status.HTTP_201_CREATED)
async def apply_to_job(job_id: str, payload: ApplicationCreate, db: AsyncSession = Depends(get_db)):
    """Step 7b: Job Application"""
    # Verify student exists
    student_res = await db.execute(select(Student).where(Student.id == payload.student_id))
    if not student_res.scalars().first():
        raise HTTPException(status_code=404, detail="Student not found")
        
    # Verify job exists
    job_res = await db.execute(select(JobPosting).where(JobPosting.id == job_id))
    if not job_res.scalars().first():
        raise HTTPException(status_code=404, detail="Job not found")

    application = JobApplication(
        student_id=payload.student_id,
        job_id=job_id,
        status="applied"
    )
    db.add(application)
    await db.commit()
    await db.refresh(application)
    return {"message": "Successfully applied to job", "application_id": application.id}
    
@router.patch("/applications/{application_id}/status")
async def update_application_status(application_id: str, status: str, db: AsyncSession = Depends(get_db)):
    """Step 8: Placement Outcome (Interview -> Selection)"""
    res = await db.execute(select(JobApplication).where(JobApplication.id == application_id))
    application = res.scalars().first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")
        
    valid_statuses = ["applied", "shortlisted", "interview", "selected", "rejected"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {valid_statuses}")
        
    application.status = status
    await db.commit()
    return {"message": f"Application status updated to {status}"}
