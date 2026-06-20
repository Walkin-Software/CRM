"""
Pydantic Schemas — Request/Response models for all entities.
Provides validation, serialization, and OpenAPI documentation.
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional, List, Any, Dict
from pydantic import BaseModel, EmailStr, Field, field_validator
import re


# ─── Shared ───────────────────────────────────────────────────

class PaginationParams(BaseModel):
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=100)


class PaginatedResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[Any]


# ─── Auth ─────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = 3600
    user: "UserOut"


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = 3600


# ─── Users ────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=2, max_length=255)
    role_id: Optional[str] = None


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    role_id: Optional[str]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role_id: Optional[str] = None
    is_active: Optional[bool] = None


# ─── Leads ────────────────────────────────────────────────────

class LeadCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=255)
    phone: str
    email: Optional[EmailStr] = None
    interest: Optional[str] = None
    description: Optional[str] = None
    lead_type: Optional[str] = "form"
    job_role: Optional[str] = None
    years_experience: Optional[float] = None
    source: Optional[str] = "manual"
    status: Optional[str] = "new"
    assigned_to: Optional[str] = None
    tags: Optional[List[str]] = []
    lead_score: Optional[int] = Field(0, ge=0, le=100)
    lead_temperature: Optional[str] = None
    campaign_id: Optional[str] = None
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    keyword: Optional[str] = None
    conversion_source: Optional[str] = None
    custom_metadata: Optional[Dict[str, Any]] = Field(default={})

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        cleaned = re.sub(r"[\s\-\(\)]", "", v)
        if not re.match(r"^\+?[1-9]\d{7,14}$", cleaned):
            raise ValueError("Invalid phone number format")
        return cleaned

    class Config:
        populate_by_name = True


class LeadUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    interest: Optional[str] = None
    description: Optional[str] = None
    lead_type: Optional[str] = None
    job_role: Optional[str] = None
    years_experience: Optional[float] = None
    source: Optional[str] = None
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    tags: Optional[List[str]] = None
    lead_score: Optional[int] = Field(default=None, ge=0, le=100)
    lead_temperature: Optional[str] = None
    campaign_id: Optional[str] = None
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    keyword: Optional[str] = None
    conversion_source: Optional[str] = None


class LeadOut(BaseModel):
    id: str
    full_name: str
    phone: str
    email: Optional[str]
    interest: Optional[str]
    description: Optional[str]
    lead_type: str
    job_role: Optional[str]
    years_experience: Optional[float]
    source: str
    status: str
    assigned_to: Optional[str]
    tags: List[str]
    lead_score: int
    lead_temperature: str
    campaign_id: Optional[str]
    utm_source: Optional[str]
    utm_medium: Optional[str]
    utm_campaign: Optional[str]
    keyword: Optional[str]
    conversion_source: Optional[str]
    custom_metadata: Optional[Dict[str, Any]] = Field(default={})
    created_at: datetime
    updated_at: datetime
    assigned_user: Optional[UserOut] = None

    class Config:
        from_attributes = True
        populate_by_name = True


# ─── Notes ────────────────────────────────────────────────────

class NoteCreate(BaseModel):
    content: str = Field(min_length=1)


class NoteOut(BaseModel):
    id: str
    lead_id: str
    author_id: Optional[str]
    content: str
    created_at: datetime
    author: Optional[UserOut] = None

    class Config:
        from_attributes = True


# ─── Follow-ups ───────────────────────────────────────────────

class FollowUpCreate(BaseModel):
    scheduled_at: datetime
    method: str = Field(pattern="^(call|whatsapp|sms|email)$")
    note: Optional[str] = None


class FollowUpUpdate(BaseModel):
    is_completed: Optional[bool] = None
    completed_at: Optional[datetime] = None
    note: Optional[str] = None


class FollowUpOut(BaseModel):
    id: str
    lead_id: str
    scheduled_at: datetime
    method: str
    note: Optional[str]
    is_completed: bool
    completed_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


# ─── Calls ────────────────────────────────────────────────────

class CallOut(BaseModel):
    id: str
    twilio_call_sid: Optional[str]
    lead_id: Optional[str]
    direction: str
    status: str
    from_number: str
    to_number: str
    duration_seconds: int
    recording_url: Optional[str]
    started_at: Optional[datetime]
    ended_at: Optional[datetime]
    handled_by: str
    created_at: datetime

    class Config:
        from_attributes = True


class OutboundCallRequest(BaseModel):
    lead_id: str
    to_number: Optional[str] = None
    message: Optional[str] = None


class AIScreeningStartResponse(BaseModel):
    session_id: str
    questions: List[str]


class AIScreeningSubmitRequest(BaseModel):
    answers: List[str] = Field(min_length=3, max_length=3)
    audio_base64: Optional[str] = None
    audio_mime: Optional[str] = "audio/webm"


class AIScreeningSessionOut(BaseModel):
    id: str
    lead_id: str
    questions: List[str]
    answers: List[str]
    audio_path: Optional[str]
    ai_sms_message: Optional[str]
    ai_email_message: Optional[str]
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class SendNotificationRequest(BaseModel):
    lead_id: Optional[str] = None
    channel: str
    to: str
    body: str


class GenerateLeadMessageRequest(BaseModel):
    lead_id: str


class NotificationOut(BaseModel):
    id: str
    lead_id: Optional[str]
    channel: str
    status: str
    content: str
    recipient_phone: Optional[str]
    recipient_email: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ─── Analytics ────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_leads: int
    new_leads_today: int
    total_calls_today: int
    conversion_rate: float
    avg_call_duration_seconds: float
    leads_by_status: Dict[str, int]
    calls_by_direction: Dict[str, int]
    top_intents: List[Dict[str, Any]]
    # 7-day delta comparisons
    leads_delta_pct: float = 0.0
    calls_delta_pct: float = 0.0
    # Extra KPIs
    pending_follow_ups: int = 0
    notifications_today: int = 0


class DashboardActivityPoint(BaseModel):
    date: str          # ISO date string YYYY-MM-DD
    leads: int
    calls: int


class DashboardActivity(BaseModel):
    items: List[DashboardActivityPoint]
