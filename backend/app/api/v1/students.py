from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List

from app.core.database import get_db
from app.models.models import Student, Lead, JobPosting
from pydantic import BaseModel

router = APIRouter()

class StudentCreate(BaseModel):
    lead_id: str | None = None
    full_name: str
    phone: str
    email: str
    skills: list[str] = []
    course: str | None = None
    resume_url: str | None = None

class JobMatchResponse(BaseModel):
    job_id: str
    company_name: str
    role: str
    match_score: int

@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register_student(payload: StudentCreate, db: AsyncSession = Depends(get_db)):
    """Step 6: Student Registration & Profile Creation"""
    # Check if lead exists and update status to converted
    if payload.lead_id:
        result = await db.execute(select(Lead).where(Lead.id == payload.lead_id))
        lead = result.scalars().first()
        if lead:
            lead.status = "converted"
            
    new_student = Student(
        lead_id=payload.lead_id,
        full_name=payload.full_name,
        phone=payload.phone,
        email=payload.email,
        skills=payload.skills,
        course=payload.course,
        resume_url=payload.resume_url
    )
    db.add(new_student)
    await db.commit()
    await db.refresh(new_student)
    return {"message": "Student registered successfully", "student_id": new_student.id}

@router.post("/{student_id}/match", response_model=List[JobMatchResponse])
async def match_jobs(student_id: str, db: AsyncSession = Depends(get_db)):
    """Step 8: Job Matching AI (Score generation based on skills)"""
    result = await db.execute(select(Student).where(Student.id == student_id))
    student = result.scalars().first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
        
    # Fetch active jobs
    jobs_result = await db.execute(select(JobPosting).where(JobPosting.status == "published"))
    jobs = jobs_result.scalars().all()
    
    matches = []
    student_skills_set = set([s.lower() for s in student.skills])
    
    for job in jobs:
        job_skills_set = set([s.lower() for s in job.required_skills])
        
        if not job_skills_set:
            score = 50 # Default score if job has no specific requirements
        else:
            intersection = student_skills_set.intersection(job_skills_set)
            score = int((len(intersection) / len(job_skills_set)) * 100)
            
        if score > 0 or not job_skills_set:
            matches.append({
                "job_id": job.id,
                "company_name": job.company_name,
                "role": job.role,
                "match_score": score
            })
            
    # Sort by highest score first
    matches.sort(key=lambda x: x["match_score"], reverse=True)
    return matches
