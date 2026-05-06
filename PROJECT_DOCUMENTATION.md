# AI Phone Agent CRM — Complete Project Documentation

> **Last Updated:** May 2026  
> **Status:** Active Development  
> **Stack:** FastAPI · React 19 · MySQL · Twilio · OpenAI · Stripe

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Complete Architecture](#2-complete-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Database Schema](#4-database-schema)
5. [Backend API — All Endpoints](#5-backend-api--all-endpoints)
6. [Frontend Pages & Features](#6-frontend-pages--features)
7. [AI & Automation Features](#7-ai--automation-features)
8. [Implemented Features Checklist](#8-implemented-features-checklist)
9. [Pending / To-Be-Built Features](#9-pending--to-be-built-features)
10. [Data Flow Walkthroughs](#10-data-flow-walkthroughs)
11. [Infrastructure & Configuration](#11-infrastructure--configuration)
12. [Development Estimates](#12-development-estimates)

---

## 1. Project Overview

**AI Phone Agent CRM** is a full-stack sales and lead management platform built for training institutes, placement agencies, and education-tech companies. It automates the entire student acquisition funnel — from the moment a lead lands to when they get placed in a job.

### Core Purpose
- **Inbound/Outbound AI phone calls** — AI agents handle initial contact automatically
- **Multi-channel outreach** — SMS, WhatsApp, Email on a single platform
- **Full CRM lifecycle** — Lead → Contacted → Qualified → Demo → Converted → Student → Placed
- **AI screening** — Automatically generates questions, transcribes calls, follows up
- **Job placement pipeline** — Students get matched to jobs by skill; applications tracked end-to-end

### Who Uses It
| Role | Access |
|------|--------|
| **Admin** | Full system access, user management, audit logs, all leads |
| **Agent** | Assigned leads, call/message actions, scheduling |
| **Viewer** | Read-only dashboard and reporting |

---

## 2. Complete Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React 19 + Vite)                  │
│  Dashboard · Leads · CallLogs · LeadDetail · Analytics · Scheduling  │
│  Notifications · Login                                               │
│                    Port: 5173                                        │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ REST API (Axios)
                                │ JWT Bearer Token
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    BACKEND (FastAPI · Python 3.12)                   │
│                         Port: 3003                                   │
│                                                                      │
│  ┌───────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │   Auth    │  │  Leads   │  │  Calls   │  │  Notifications   │   │
│  │  /api/auth│  │/api/leads│  │/api/calls│  │/api/notifications│   │
│  └───────────┘  └──────────┘  └──────────┘  └──────────────────┘   │
│                                                                      │
│  ┌───────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │    AI     │  │ Students │  │   Jobs   │  │   Scheduling     │   │
│  │  /api/ai  │  │/api/stud │  │ /api/jobs│  │/api/scheduling   │   │
│  └───────────┘  └──────────┘  └──────────┘  └──────────────────┘   │
│                                                                      │
│  ┌───────────┐  ┌──────────┐  ┌─────────────────────────────────┐  │
│  │   Admin   │  │  Users   │  │     Lead Automation Service      │  │
│  │/api/admin │  │/api/users│  │   (auto SMS + Email on lead add) │  │
│  └───────────┘  └──────────┘  └─────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    AI Content Service                          │ │
│  │   GPT-4o-mini → Screening Qs · SMS/Email · Call Openings      │ │
│  └────────────────────────────────────────────────────────────────┘ │
└───────┬───────────────────┬──────────────────────┬──────────────────┘
        │                   │                       │
        ▼                   ▼                       ▼
┌──────────────┐   ┌─────────────────┐   ┌──────────────────────────┐
│  MySQL DB    │   │  Twilio API     │   │     OpenAI API           │
│  (port 3306) │   │  SMS / WhatsApp │   │  GPT-4o-mini · Whisper   │
│              │   │  Voice Calls    │   │  Transcription           │
└──────────────┘   └─────────────────┘   └──────────────────────────┘
        │                   │
        ▼                   ▼
┌──────────────┐   ┌─────────────────┐
│  Redis Cache │   │  SMTP Server    │
│  (port 6379) │   │  Email Sending  │
└──────────────┘   └─────────────────┘

External Webhooks (Twilio → Backend):
  POST /api/notifications/webhooks/twilio/status  ← Delivery tracking
  POST /api/notifications/webhooks/twilio/inbound ← Inbound SMS/WhatsApp
```

### Service Boundaries

```
/backend/           ← Main monolith API (all features)
/services/crm-service/  ← Microservice variant (same capabilities,
                          designed to proxy to separate services)
/frontend/          ← Single Page Application
/database/          ← Schema migrations + seed data
/storage/recordings/  ← Call recording files (local disk)
```

---

## 3. Technology Stack

### Backend
| Layer | Technology | Version |
|-------|-----------|---------|
| Web Framework | FastAPI | 0.109.0 |
| ORM | SQLAlchemy (async) | Latest |
| Database Driver | aiomysql (MySQL), aiosqlite (SQLite fallback) | Latest |
| Data Validation | Pydantic v2 | Latest |
| Auth | python-jose (JWT) + passlib/bcrypt | Latest |
| Phone/SMS | Twilio SDK | Latest |
| AI | OpenAI SDK (GPT-4o-mini, Whisper) | Latest |
| Payments | Stripe SDK | Latest |
| Task Queue | Celery | Latest |
| Cache | Redis | Latest |
| Migrations | Alembic | Latest |
| Logging | Loguru | Latest |
| Testing | pytest + pytest-asyncio | Latest |

### Frontend
| Layer | Technology | Version |
|-------|-----------|---------|
| UI Framework | React | 19.2.5 |
| Build Tool | Vite | 8.x |
| Routing | React Router | 7.14.2 |
| HTTP Client | Axios | Latest |
| Charts | Recharts | Latest |
| Icons | Lucide React | Latest |
| Toasts | React Hot Toast | Latest |
| Dates | date-fns | Latest |
| Linting | ESLint | Latest |

### Infrastructure
| Component | Technology |
|-----------|-----------|
| Database | MySQL 8.x |
| Caching | Redis |
| File Storage | Local disk (`/storage/recordings/`) |
| Email | SMTP (configurable host) |
| SMS / WhatsApp | Twilio |
| Voice | Twilio Programmable Voice |
| AI | OpenAI |
| Payments | Stripe |

---

## 4. Database Schema

### Tables (18 total)

| # | Table | Purpose |
|---|-------|---------|
| 1 | `roles` | RBAC roles with JSON permissions |
| 2 | `users` | User accounts (email, hashed_password, role) |
| 3 | `refresh_tokens` | JWT refresh token store with expiry |
| 4 | `leads` | Core CRM lead records |
| 5 | `lead_notes` | Notes attached to leads |
| 6 | `lead_follow_ups` | Scheduled follow-up tasks |
| 7 | `calls` | Inbound/outbound call logs |
| 8 | `conversations` | AI conversation sessions |
| 9 | `conversation_messages` | Individual messages in a conversation |
| 10 | `ai_screening_sessions` | 3-question AI screening Q&A |
| 11 | `notifications` | SMS / WhatsApp / Email / Push sent records |
| 12 | `time_slots` | Agent availability windows |
| 13 | `bookings` | Demo/meeting bookings linked to slots |
| 14 | `transactions` | Stripe payment records |
| 15 | `audit_logs` | Every user action tracked |
| 16 | `students` | Student profiles (skills, course, resume) |
| 17 | `job_postings` | Job openings |
| 18 | `job_applications` | Student applications with status pipeline |

### Key Enums & Statuses

**Lead Status Flow:**
```
new → contacted → qualified → demo_scheduled → proposal_sent → converted
                                                             → lost
                                                             → unresponsive
```

**Lead Sources:**
```
inbound_call · outbound_call · web_form · whatsapp · sms · referral · social_media · manual
```

**Call Status:**
```
initiated → ringing → in_progress → answered → hangup → completed
                                              → no_response → failed
```

**Notification Status:**
```
pending → sent → delivered → read → failed
```

**Job Application Status:**
```
applied → shortlisted → interview → selected → rejected
```

---

## 5. Backend API — All Endpoints

### Auth (`/api/auth`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/register` | Register new user | Public |
| POST | `/login` | Login → JWT + refresh token | Public |
| POST | `/refresh` | Exchange refresh token | Public |
| POST | `/logout` | Revoke refresh token | Required |

### Users (`/api/users`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/` | List all users | Admin |
| GET | `/me` | Current user profile | Required |
| PATCH | `/{user_id}` | Update user | Admin |

### Leads (`/api/leads`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/` | List leads (filter, search, paginate) | Required |
| POST | `/` | Create lead + auto trigger AI outreach | Required |
| POST | `/public` | Public form endpoint (no auth) | Public |
| GET | `/{lead_id}` | Get single lead | Required |
| PATCH | `/{lead_id}` | Update lead | Required |
| DELETE | `/{lead_id}` | Delete lead | Admin |

### Notes (`/api/leads/{lead_id}/notes`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/` | Add note to lead | Required |
| GET | `/` | List all notes for lead | Required |
| DELETE | `/{note_id}` | Delete note (author or admin) | Required |

### Follow-ups (`/api/leads/{lead_id}/follow-ups`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/` | Schedule follow-up | Required |
| GET | `/` | List follow-ups for lead | Required |
| PATCH | `/{follow_up_id}` | Mark complete / update | Required |

### Calls (`/api/calls`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/` | List calls (filter: status, direction, lead_id) | Required |
| POST | `/outbound` | Initiate AI outbound call | Required |
| POST | `/scheduled` | Schedule future call | Required |
| GET | `/{call_id}/recording` | Stream/download call recording | Required |
| GET | `/{call_id}/transcript` | Get auto-transcribed transcript | Required |

### Notifications (`/api/notifications`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/templates` | List message templates | Required |
| POST | `/send` | Send SMS / WhatsApp / Email | Required |
| POST | `/generate-and-send` | AI-generate + send from screening answers | Required |
| GET | `/history` | Paginated sent history | Required |
| POST | `/webhooks/twilio/status` | Twilio delivery callback | Webhook |
| POST | `/webhooks/twilio/inbound` | Receive inbound SMS/WhatsApp | Webhook |

### AI Workflows (`/api/ai`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/leads/{lead_id}/screening/start` | Generate 3 screening questions | Required |
| POST | `/screening/{session_id}/submit` | Submit answers + audio | Required |
| GET | `/leads/{lead_id}/screening/latest` | Get latest screening session | Required |
| GET | `/monitor/sessions` | All sessions with lead names | Required |
| GET | `/monitor/sessions/{session_id}` | Detailed session conversation | Required |

### Students (`/api/students`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/register` | Register student (links to lead, marks converted) | Required |
| POST | `/{student_id}/match` | AI job matching by skills | Required |

### Jobs (`/api/jobs`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/` | Create job posting | Required |
| POST | `/{job_id}/apply` | Student applies to job | Required |
| PATCH | `/applications/{application_id}/status` | Update application status | Required |

### Scheduling (`/api/scheduling`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/slots/available` | Get available time slots | Required |
| POST | `/slots` | Create new availability slot | Required |
| POST | `/bookings` | Book a slot for a lead | Required |
| PATCH | `/bookings/{booking_id}` | Update booking (reschedule/cancel) | Required |

### Admin (`/api/admin`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/dashboard/stats` | KPI summary (leads, calls, conversion) | Admin |
| GET | `/audit-logs` | Paginated audit log | Admin |

### Integrations (`/api/integrations`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/scrape/sample` | Import sample leads from social media | Admin |

---

## 6. Frontend Pages & Features

### Login (`/login`)
- Email + password form
- JWT token stored in context
- Redirect to dashboard on success

### Dashboard (`/`)
**Stats Cards (live from API):**
- Total Leads
- Calls Today
- Conversion Rate
- Average Call Duration

**Charts:**
- 14-day Area Chart — Daily leads + calls trend
- Bar Chart — Lead status distribution
- Recent Leads — Latest 6 leads
- Recent Dispatches — Latest 6 notifications

### Leads (`/leads`)
- Paginated lead list (10 per page)
- Search by name / email / phone / interest
- Filter by status dropdown
- Export to CSV
- Auto-refresh every 15 seconds
- Quick actions per row:
  - **Call** — Trigger AI outbound call instantly
  - **Message** — Send AI-generated SMS + Email
  - **View** — Go to lead detail
- Create Lead modal (manual entry)

### Lead Detail (`/leads/:id`)
- Full contact info + status badge
- **Notes** — Add/view/delete with author + timestamp
- **AI Screening:**
  - Generate 3 contextual questions
  - Answer form with optional audio upload
  - Submit → auto-generates follow-up SMS + Email
- **Follow-ups** — Scheduled tasks with method + completion checkbox
- **Call History** — Linked calls
- Action buttons: AI Call · Send Message · Schedule Demo · Payment

### Call Logs (`/calls`)
- Table: direction, from/to numbers, status, duration, timestamp
- Audio player for recorded calls
- Transcript viewer (auto-transcribed)
- Download recording as .wav
- Total duration stat

### Analytics (`/analytics`)
- Conversion funnel bar chart (leads by status stage)
- Lead sources pie chart
- Revenue growth line chart (weekly projections)
- KPI badges with color coding

### Scheduling (`/scheduling`)
- Today / Week slot filter
- Agent availability slots
- Create new slot
- Upcoming bookings with reschedule / cancel

### Notifications (`/notifications`)
- WhatsApp template builder
- Email template builder
- Templates stored in localStorage
- Pre-loaded starter templates (welcome, reminder, follow-up)

### Layout & Navigation
- Sidebar: Dashboard · Leads · Call Logs · Scheduling · Analytics · Notifications
- User profile + role indicator + logout
- Topbar with page title + system status badge

---

## 7. AI & Automation Features

### AI Content Service

| Feature | How It Works |
|---------|-------------|
| **Screening Questions** | GPT-4o-mini generates 3 contextual questions from lead profile (name, job role, experience, interest) |
| **Follow-up SMS** | GPT generates <220 char SMS from screening answers |
| **Follow-up Email** | GPT generates professional email body from screening answers |
| **Call Opening Line** | GPT generates natural opening <35 words for outbound call |
| **Call Transcription** | OpenAI Whisper transcribes call recordings to text |
| **Fallback** | If MOCK_SERVICES=true or OpenAI unreachable, hardcoded templates used |

### Lead Automation (Triggered on Every New Lead)
```
Lead Created
    ↓
Generate AI call script
    ↓
Create Outbound Call record
    ↓
Send auto-generated SMS (Twilio)
    ↓
Send auto-generated Email (SMTP)   ← only if email provided
```

### AI Job Matching
- Student skills array compared against job requirements
- Intersection score computed
- Returns ranked job list

---

## 8. Implemented Features Checklist

### Authentication & Security
- [x] Email + password login with JWT
- [x] Refresh token rotation
- [x] Role-based access control (admin / agent / viewer)
- [x] Password hashing (bcrypt)
- [x] Comprehensive audit logging
- [x] User management (create, update, list)

### Lead Management
- [x] Full CRUD for leads
- [x] Public form endpoint (no auth, for web embeds)
- [x] Lead search + filter + pagination
- [x] Lead status lifecycle
- [x] Lead source tracking
- [x] Duplicate detection (24hr window)
- [x] Notes system (add, view, delete)
- [x] Follow-up scheduling (call, SMS, WhatsApp, email)
- [x] Bulk export to CSV
- [x] Assignment to agents

### Call Management
- [x] Inbound call logging
- [x] Outbound AI call initiation
- [x] Call scheduling (future time)
- [x] Recording storage + streaming
- [x] Recording download
- [x] Auto-transcription via Whisper
- [x] Transcript Q&A display
- [x] Call status tracking

### Notifications (Multi-Channel)
- [x] SMS via Twilio
- [x] WhatsApp via Twilio
- [x] Email via SMTP
- [x] AI-generated message content
- [x] Delivery status tracking (webhook)
- [x] Inbound message handling
- [x] Notification history
- [x] Template system

### AI Workflows
- [x] 3-question screening generation
- [x] Screening answer submission
- [x] Audio upload for screening
- [x] Session monitoring
- [x] Auto follow-up message generation
- [x] Call opening generation
- [x] Call transcription

### Student & Placement
- [x] Student registration (linked to lead)
- [x] Skill profile
- [x] Resume URL
- [x] Job posting creation
- [x] Job application submission
- [x] Application status pipeline
- [x] AI skill-based job matching

### Scheduling
- [x] Agent availability slots
- [x] Demo booking system
- [x] Booking status management
- [x] Confirmation codes

### Analytics & Reporting
- [x] Dashboard KPI cards
- [x] Daily trend charts (14-day)
- [x] Lead status funnel chart
- [x] Lead source pie chart
- [x] Call duration stats
- [x] Recent leads + dispatches feed

### Infrastructure
- [x] FastAPI async backend
- [x] MySQL async ORM
- [x] Redis caching integration
- [x] Celery task queue setup
- [x] CORS configuration
- [x] Structured logging (Loguru)
- [x] Database schema + seed data
- [x] Auto-import of missed Twilio webhooks on call list

---

## 9. Pending / To-Be-Built Features

### High Priority (Core Gaps)

| Feature | Description | Complexity |
|---------|-------------|-----------|
| **Real Twilio Voice Integration** | Connect outbound calls to actual Twilio TwiML app; handle IVR + AI agent response loop | High |
| **WhatsApp Template Approval Flow** | Push created templates to Twilio for Meta approval; track approval status | Medium |
| **Email Template Persistence** | Move templates from localStorage to database-backed storage | Low |
| **Real-time Notifications** | WebSocket or SSE for live call status updates without polling | Medium |
| **Payment Flow UI** | Stripe checkout integration in frontend; fee collection for converted leads | High |
| **Student Portal** | Separate login/view for students to see their profile and job matches | High |

### Medium Priority (Enhancement)

| Feature | Description | Complexity |
|---------|-------------|-----------|
| **Lead Import (CSV/Excel)** | Bulk upload leads from spreadsheet | Medium |
| **Advanced Analytics** | Revenue attribution, agent performance, call outcome analysis, cohort charts | High |
| **Call Recording Expiry** | Auto-delete old recordings; cloud storage (S3/GCS) for scalability | Medium |
| **Twilio Conversation API** | Two-way WhatsApp threading; read reply history inline | Medium |
| **SMS Opt-out Handling** | STOP keyword compliance; unsubscribe tracking | Medium |
| **Scheduled Follow-up Automation** | Celery beat to auto-send follow-ups at due time | Medium |
| **Agent Calendar View** | Visual weekly calendar for scheduling page | Medium |
| **Lead Scoring** | Auto-score leads 0–100 based on engagement, responses, call outcome | High |
| **Email Open Tracking** | Pixel tracking for sent emails; show "opened" in notification history | Medium |

### Low Priority (Nice to Have)

| Feature | Description | Complexity |
|---------|-------------|-----------|
| **Dark Mode** | Toggle dark/light theme in UI | Low |
| **Mobile App** | React Native or PWA for agents on the go | High |
| **WhatsApp Chatbot** | Automated inbound WhatsApp response flow | High |
| **Referral Tracking** | Track which student/lead referred new leads | Medium |
| **Invoice Generation** | Auto-generate PDF invoices for payments | Medium |
| **Multi-language** | i18n support for UI + AI messages | High |
| **API Webhooks (outbound)** | Let customers subscribe to lead/call events via webhook | High |
| **Audit Log Export** | Download audit logs as CSV | Low |
| **Two-factor Authentication** | TOTP/HOTP support for logins | Medium |
| **Zapier / n8n Integration** | Low-code workflow triggers for third-party tools | High |

---

## 10. Data Flow Walkthroughs

### Flow 1: New Lead → AI Outreach

```
1. Lead form submitted (web form or agent creates manually)
         ↓
2. POST /api/leads
         ↓
3. Duplicate check (same phone within 24hr)
         ↓
4. Lead record saved to MySQL
         ↓
5. Audit log entry created
         ↓
6. Lead Automation triggered (background):
         ├── GPT generates call script
         ├── Creates Call record (status: initiated)
         ├── GPT generates SMS message
         ├── Sends SMS via Twilio → creates Notification record
         ├── GPT generates Email body
         └── Sends Email via SMTP → creates Notification record
         ↓
7. Frontend shows toast: "Lead created"
8. Auto-refresh fetches new lead in list after 15s
```

### Flow 2: AI Screening

```
1. Agent opens Lead Detail page
         ↓
2. Clicks "Generate Screening Questions"
         ↓
3. POST /api/ai/leads/{id}/screening/start
         ↓
4. GPT-4o-mini generates 3 questions (using: name, job, experience, interest)
         ↓
5. AIScreeningSession created in DB
         ↓
6. Questions shown in UI form
         ↓
7. Agent fills in answers (optionally records audio)
         ↓
8. POST /api/ai/screening/{session_id}/submit
         ↓
9. Backend:
         ├── Saves answers to AIScreeningSession
         ├── Saves audio file to /storage/recordings/
         ├── GPT generates follow-up SMS + Email from answers
         ├── Creates Call log (type: ai_screening)
         └── Creates Conversation + ConversationMessages
         ↓
10. Confirmation shown in UI
```

### Flow 3: Call Recording → Transcript

```
1. Call ends (Twilio webhook updates status to completed)
         ↓
2. Agent opens Call Logs page
         ↓
3. Clicks "Transcript" on a call row
         ↓
4. GET /api/calls/{call_id}/transcript
         ↓
5. Backend checks if transcript already exists in Conversation messages
         ↓
6. If not: fetches recording file → sends to OpenAI Whisper → parses text
         ↓
7. Stores transcript as ConversationMessages in DB
         ↓
8. Returns formatted Q&A transcript to frontend
         ↓
9. Transcript modal opens in UI
```

### Flow 4: Lead → Student → Job Match

```
1. Lead converted → admin clicks "Register as Student"
         ↓
2. POST /api/students/register
   (full_name, phone, email, skills[], course, resume_url, lead_id)
         ↓
3. Student record created; Lead status → "converted"
         ↓
4. Admin creates job postings: POST /api/jobs
         ↓
5. Student browses jobs (or admin matches):
   POST /api/students/{student_id}/match
         ↓
6. Backend computes skill intersection scores → returns ranked jobs
         ↓
7. Student applies: POST /api/jobs/{job_id}/apply
         ↓
8. Application status pipeline:
   applied → shortlisted → interview → selected → rejected
         ↓
9. Admin updates: PATCH /api/jobs/applications/{id}/status
```

---

## 11. Infrastructure & Configuration

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Backend server port | `3003` |
| `DATABASE_URL` | MySQL async connection | `mysql+aiomysql://root:pass@localhost:3306/ai_phone_agent` |
| `REDIS_URL` | Redis connection | `redis://localhost:6379` |
| `JWT_SECRET` | JWT signing secret | `change-me-in-production` |
| `JWT_ALGORITHM` | JWT algorithm | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access token TTL | `60` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Refresh token TTL | `30` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-...` |
| `OPENAI_MODEL` | Model name | `gpt-4o-mini` |
| `TWILIO_ACCOUNT_SID` | Twilio account | `ACxxx` |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | `xxx` |
| `TWILIO_PHONE_NUMBER` | Twilio sender number | `+1234567890` |
| `SMTP_HOST` | Email SMTP server | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | `you@gmail.com` |
| `SMTP_PASS` | SMTP password | `app-password` |
| `MOCK_SERVICES` | Disable real API calls | `true` / `false` |
| `CORS_ALLOWED_ORIGINS` | Frontend origins | `["http://localhost:5173"]` |

### Running Locally

```bash
# Backend
cd backend
pip install -r requirements.txt
./run_backend.sh
# Starts FastAPI on http://localhost:3003

# Frontend
cd frontend
npm install
npm run dev
# Starts React on http://localhost:5173
```

### Ports Summary

| Service | Port |
|---------|------|
| FastAPI Backend | 3003 |
| React Frontend | 5173 |
| MySQL | 3306 |
| Redis | 6379 |

---

## 12. Development Estimates

> Estimates are for a senior full-stack developer working solo.  
> Complex = requires architecture, not just code.

### Remaining High-Priority Features

| Feature | Estimated Time |
|---------|---------------|
| Real Twilio Voice / TwiML AI agent loop | 3–4 days |
| WebSocket real-time call status | 1–2 days |
| Stripe payment checkout UI + backend | 2–3 days |
| Student portal (separate login view) | 2–3 days |
| WhatsApp template approval tracking | 1 day |
| Email template DB persistence | 0.5 day |
| **Total High Priority** | **~10–13 days** |

### Medium-Priority Features

| Feature | Estimated Time |
|---------|---------------|
| CSV/Excel lead import | 1 day |
| Advanced analytics (agent perf, revenue) | 3–4 days |
| S3/GCS recording storage | 1 day |
| Twilio Conversation threading | 1–2 days |
| Celery beat — scheduled follow-up sender | 1–2 days |
| Lead scoring algorithm | 2 days |
| Email open tracking | 1 day |
| Agent calendar view | 1–2 days |
| SMS opt-out compliance | 0.5 day |
| **Total Medium Priority** | **~12–15 days** |

### Low-Priority / Nice-to-Have

| Feature | Estimated Time |
|---------|---------------|
| Dark mode | 0.5 day |
| WhatsApp chatbot flow | 3–5 days |
| Mobile app (PWA) | 5–7 days |
| Referral tracking | 1 day |
| PDF invoice generation | 1 day |
| 2FA (TOTP) | 1–2 days |
| i18n multi-language | 3–5 days |
| Outbound webhook system | 2–3 days |
| Zapier/n8n integration | 2–3 days |
| **Total Low Priority** | **~19–27 days** |

### Total Remaining Estimate

| Priority | Time |
|----------|------|
| High | ~10–13 days |
| Medium | ~12–15 days |
| Low | ~19–27 days |
| **Grand Total** | **~41–55 days (solo dev)** |

> With a 2-person team focusing only on High + Medium: **~11–14 days to production-ready MVP+**

---

## Summary: What's Done vs What's Left

### Done ✅
- Full CRM lead lifecycle (create → qualify → convert)
- Multi-channel messaging (SMS, WhatsApp, Email)
- AI-powered screening, follow-up generation, call transcription
- Inbound/outbound call logging with recording + transcript
- Student registration + job posting + AI job matching
- Demo scheduling system
- Analytics dashboard with live charts
- JWT auth with RBAC (admin/agent/viewer)
- Comprehensive audit logging
- Twilio webhook handling (delivery tracking + inbound SMS)
- Public lead form endpoint
- Auto-outreach on lead creation

### Still Needed 🔧
- Actual live Twilio voice calls (TwiML + AI response loop)
- Real-time WebSocket updates
- Stripe payment checkout
- Student-facing portal
- Cloud recording storage (S3/GCS)
- Advanced analytics
- Celery scheduled jobs running
- Lead scoring
- Mobile access (PWA or app)

---

*Document generated from live codebase analysis — May 2026*
