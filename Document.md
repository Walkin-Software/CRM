# Lead to Call Technical Flow

Last updated: 06 May 2026
Document type: Technical implementation flow for client sharing

## 1. Scope
This document explains:
- How lead data triggers calling flow
- How call is created and progressed
- How transcription starts only after call completion
- How AI generates response guidance from the actual conversation
- How Google Meet is scheduled when candidate confirms date and time
- How Twilio webhooks are routed through Nginx into backend
- How AI agent training feedback loop is maintained
- Which APIs are used in the process
- How data is stored (MongoDB architecture reference for client communication)

## 2. High-Level Architecture (Client Version)
Frontend app sends lead data to backend APIs.
Backend validates and stores lead and call lifecycle data in MongoDB.
Backend then triggers call and communication workflows using integrated APIs.

Components:
- Frontend: React application
- Backend: FastAPI service
- Database: MongoDB
- Reverse proxy: Nginx
- External providers: Twilio, OpenAI, AssemblyAI, Google Calendar/Meet API, SMTP mail service

## 3. Lead Data Entry Paths
Lead data can enter through two API routes:

1. Authenticated lead creation
- Endpoint: POST /api/leads
- Purpose: Internal users create lead from CRM panel

2. Public lead creation
- Endpoint: POST /api/leads/public
- Purpose: Website form submits lead without login

Both routes perform:
- Duplicate check by phone for last 24 hours
- Lead creation with status = new
- Automation trigger call after lead is stored

## 4. How Call Trigger Happens
After lead is created, backend executes automation trigger.

Trigger point:
- Service: lead automation service
- Method: trigger_lead_automation

What this method does:
1. Generates AI call opening script
2. Creates outbound call record linked to lead
3. Generates SMS and Email follow-up text
4. Stores notification records and marks dispatch status
5. Starts Twilio-driven outbound call lifecycle

Result:
- Lead gets an immediate outbound calling workflow entry
- Communication journey starts from first lead capture itself

## 5. Direct Call Trigger APIs
In addition to auto trigger, backend provides manual/scheduled call trigger routes.

1. Manual outbound trigger
- Endpoint: POST /api/calls/outbound
- Use case: Agent clicks Call Now for a lead
- Action: Creates and starts outbound call process

2. Scheduled call trigger
- Endpoint: POST /api/calls/scheduled
- Use case: Call later at defined time
- Action: Delayed call task then outbound call run

3. Twilio status callback
- Endpoint: POST /api/calls/webhooks/twilio/status
- Use case: Call status updates from provider
- Action: Sync ringing, answered, no response, completed states

4. Twilio recording callback
- Endpoint: POST /api/calls/webhooks/twilio/recording
- Use case: Recording available event
- Action: Saves recording URL and updates call metadata

5. Transcript retrieval
- Endpoint: GET /api/calls/{call_id}/transcript
- Use case: Agent opens transcript in CRM
- Action: If call is completed and transcript does not exist, backend triggers transcription and then returns text

6. Call history sync from provider
- Endpoint: POST /api/calls/sync-history
- Use case: Backfill or reconcile calls if webhook delivery is delayed
- Action: Pulls recent Twilio calls and syncs local call documents

7. Recording backfill
- Endpoint: POST /api/calls/backfill-recordings
- Use case: Missing recording URL in previous calls
- Action: Fetches and updates recording metadata from Twilio

## 6. Post-Call Transcription and Text Display Flow

Business rule:
- Transcription runs only after call status is finalized (completed/answered/hangup path), not during ringing/in-progress.

Detailed flow:
1. Candidate call ends.
2. Twilio sends call status webhook to backend.
3. Twilio sends recording webhook when recording is available.
4. Backend stores recording URL in call document.
5. Agent opens transcript in CRM UI.
6. Backend checks whether transcript already exists.
7. If transcript is missing and recording exists:
- Fetch recording audio
- Send audio to AssemblyAI transcription pipeline
- Receive transcript text
- Persist transcript into conversation/call document
8. Backend returns transcript text to frontend.
9. Frontend shows final transcript to user.

Outcome:
- Transcript is generated on-demand after call completion and then reused for future views.

## 7. AI-Based Response Generation from Conversation

After transcript is available, AI can generate recommended lead responses and next actions based on what candidate actually said.

Inputs:
- Lead profile (interest, role, source)
- Call transcript text
- Prior conversation context
- CRM stage and business objective

Outputs:
- Suggested follow-up response for agent
- Suggested WhatsApp/SMS text
- Suggested email follow-up
- Suggested next question or closure line
- Confidence notes for agent review

Operational policy:
- AI suggestion is assistive and editable by agent.
- Final outbound message is sent only after agent confirmation or configured automation rule.

## 8. Google Meet Scheduling Flow (When Candidate Gives Time)

Business rule:
- If candidate provides a valid date/time during call or after-call follow-up, meeting is auto-scheduled.

Flow:
1. Candidate confirms preferred time.
2. Backend validates date/time and timezone.
3. Backend creates booking record in CRM.
4. Backend calls Google Calendar API to create event.
5. Google Meet link is generated in event details.
6. Backend stores meeting metadata in booking document:
- event_id
- meet_link
- start_time
- end_time
- organizer
7. Notification service sends confirmation SMS/Email/WhatsApp with meet link.
8. CRM timeline is updated with meeting status.

Recommended APIs in this step:
- Google Calendar API (events.insert)
- Google Meet conference data in calendar event payload

## 9. Twilio + Webhook + Nginx Flow

Purpose:
- Ensure webhook calls from Twilio reach backend reliably and securely through Nginx.

Edge flow:
1. Twilio invokes public webhook URL over HTTPS.
2. Nginx receives request on public domain.
3. Nginx forwards request to backend internal route.
4. Backend validates payload and updates call/notification state.
5. Backend returns 200 acknowledgment quickly.

Webhook routes used:
- POST /api/calls/webhooks/twilio/status
- POST /api/calls/webhooks/twilio/recording
- POST /api/notifications/webhooks/twilio/status
- POST /api/notifications/webhooks/twilio/inbound

Nginx responsibilities:
- TLS termination
- Reverse proxy routing to backend service
- Request timeout and retry-safe forwarding
- Access logging and webhook traceability
- IP allowlist and optional signature validation middleware

Recommended Nginx route design:
- Public: /webhooks/twilio/*
- Upstream map: backend /api/* webhook handlers

## 10. API and Service Integrations Used

A) Twilio APIs
Used for:
- Outbound voice call initiation
- SMS and WhatsApp messaging
- Delivery and status webhooks
- Recording lifecycle callbacks
- Call history reconciliation/backfill

Relevant backend surfaces:
- /api/calls/outbound
- /api/calls/webhooks/twilio/status
- /api/calls/webhooks/twilio/recording
- /api/calls/sync-history
- /api/calls/backfill-recordings
- /api/notifications/send
- /api/notifications/webhooks/twilio/status
- /api/notifications/webhooks/twilio/inbound

B) OpenAI APIs
Used for:
- AI screening question generation
- Follow-up SMS and email generation
- Outbound call opening line generation
- Dynamic next-question generation during conversational flow

Relevant service methods:
- generate_screening_questions
- generate_followup_messages
- generate_call_opening
- generate_sales_call_turn
- generate_dynamic_next_question

C) AssemblyAI APIs
Used for:
- Audio transcription pipeline for call recordings
- Optional real-time speech/voice interaction path

Relevant backend flow:
- Recording fetch/upload/transcript polling for call transcript endpoint

D) Google Calendar/Meet APIs
Used for:
- Creating interview/demo meeting on candidate-confirmed time
- Generating Google Meet join link
- Managing event id and schedule metadata

E) SMTP API (Email provider)
Used for:
- Sending follow-up emails through configured SMTP host

## 11. AI Agent Training and Improvement Loop

Training objective:
- Improve lead conversation quality, objection handling, and booking conversion rate.

Data used for training/evaluation:
- Call transcript text
- Candidate intent markers
- Outcome label (booked, no response, rejected, callback)
- Agent-edited final replies
- Meeting conversion result

Loop design:
1. Store transcript and call outcome.
2. Generate AI suggestions.
3. Capture agent edits versus original suggestion.
4. Score quality and conversion outcomes.
5. Periodically update prompt strategy and response templates.
6. Deploy revised prompt version with version tag.

Governance:
- PII masking before model evaluation datasets.
- Prompt/version audit log for rollback.
- Human review for low-confidence or sensitive responses.

## 12. MongoDB Data Model (Client Communication Version)
Suggested collection structure for this flow:

1. leads
- _id
- full_name
- phone
- email
- interest
- source
- status
- created_at
- assigned_to

2. calls
- _id
- lead_id
- direction
- status
- from_number
- to_number
- duration_seconds
- recording_url
- transcript_text
- transcript_status
- provider_call_sid
- created_at
- updated_at

3. notifications
- _id
- lead_id
- channel (sms, whatsapp, email)
- recipient
- content
- status
- provider_message_sid
- error_message
- sent_at

4. conversations
- _id
- lead_id
- call_id
- messages
- transcript
- ai_summary
- ai_next_best_action
- created_at

5. bookings
- _id
- lead_id
- scheduled_time
- timezone
- google_event_id
- google_meet_link
- status
- created_at

6. audit_logs
- _id
- actor_user_id
- action
- entity_type
- entity_id
- old_value
- new_value
- created_at

## 13. End-to-End Sequence (Simple)
Step 1: Lead submitted from frontend
Step 2: Backend creates lead document in MongoDB
Step 3: Backend runs automation trigger
Step 4: AI call opening is generated
Step 5: Outbound call record is created
Step 6: Twilio call is initiated or queued
Step 7: Twilio status webhooks update call state
Step 8: Twilio recording webhook provides recording link
Step 9: After call completion, transcript endpoint generates/fetches transcript
Step 10: AI generates response suggestions based on transcript
Step 11: If candidate shared preferred time, Google Meet booking is created
Step 12: Confirmation with meeting link is sent to candidate
Step 13: Agent sees call outcome, transcript, AI suggestion, and booking in CRM

## 14. Why This Flow Is Reliable
- Duplicate lead protection avoids repeated call spam
- Webhook-driven status sync keeps call lifecycle accurate
- Recording and transcript handling supports auditability
- Notification logs preserve every outreach event
- AI generation has fallback behavior when external AI is unavailable
- Nginx fronted webhook entry improves operational stability and observability
- Booking confirmation flow reduces drop-offs after candidate intent is confirmed

## 15. Client-Facing Summary
From each lead data submission, the system immediately starts a structured call journey:
- lead created
- call triggered
- status tracked in real time via webhooks
- recording captured
- transcript generated after call completion
- AI response suggestion generated from real conversation
- Google Meet booked when candidate confirms time
- communication history and scheduling trail saved

This creates a complete lead-to-call-to-conversion technical pipeline suitable for sales operations.



# AI Calling CRM Platform – Module Wise Development Cost Estimation
# Total Estimated Development Cost - 65,000 Rs

## 1. React CRM Frontend

The frontend module includes the CRM user interface developed using React. This layer is mainly responsible for displaying lead data, call history, transcript details, meeting information, and AI-generated responses received from backend APIs. The frontend also includes lead forms, authentication pages, lead tables, transcript viewing screens, and action buttons such as “Call Now” or “Schedule Meeting”.

Since the UI is mainly API-driven and does not include advanced analytics dashboards, complex animations, or custom design systems, the frontend cost is kept lower.

Technical flow:
React frontend → Backend APIs → MongoDB data → UI rendering.

---

## 2. FastAPI Backend Core Setup

This module includes the core backend architecture using FastAPI. It covers API routing, middleware setup, environment configuration, modular service structure, database connectivity, request validation, and backend project organization.

This layer acts as the central orchestration system between Twilio, OpenAI, AssemblyAI, Google APIs, and the CRM frontend.

Technical flow:
Frontend request → FastAPI API routes → Service layer → External integrations → Database updates.

---

## 3. Lead Management + MongoDB Integration

This module handles lead creation, lead storage, duplicate checks, lead updates, and lead lifecycle tracking using MongoDB.

The backend stores lead records, call references, transcript information, and meeting schedules in MongoDB collections.

Technical flow:
Lead submitted → API validation → MongoDB document creation → Lead automation trigger.

---

## 4. Twilio Calling Integration 

This is one of the most important modules because telephony integrations require asynchronous workflows and webhook lifecycle management.

This module includes:

* outbound call trigger
* call initiation APIs
* call SID tracking
* recording handling
* status synchronization

The higher cost exists because Twilio integrations involve:

* webhook reliability
* async event handling
* callback debugging
* recording lifecycle management
* provider synchronization

Technical flow:
Backend → Twilio API → Candidate receives call → Twilio callback events → Backend status updates.

---

## 5. Twilio Webhook Handling

This module manages all incoming webhook callbacks from Twilio.

Webhook events include:

* ringing
* answered
* completed
* failed
* recording available
* message delivery updates

The backend must process these events securely and update MongoDB in real time.

Technical flow:
Twilio webhook → Nginx route → Backend webhook endpoint → Database update.

---

## 6. OpenAI AI Integration

This module integrates AI-generated communication and response assistance using client-provided OpenAI credentials.

Features include:

* AI follow-up generation
* AI call opening scripts
* AI transcript summary
* next-response suggestions
* dynamic question generation

The pricing is higher because prompt engineering, structured AI outputs, and transcript-based response generation require additional backend orchestration logic.

Technical flow:
Transcript text → OpenAI prompt pipeline → AI response generation → CRM display.

---

## 7. AssemblyAI Transcript Integration

This module handles transcription generation from Twilio call recordings.

The backend:

* fetches recording URLs
* sends audio to AssemblyAI
* waits for transcript completion
* stores transcript text in MongoDB

This is an asynchronous processing flow requiring polling and transcript lifecycle handling.

Technical flow:
Call recording → AssemblyAI transcription API → Transcript response → Database storage.

---

## 8. Notification System (WhatsApp, SMS, Email)

This module manages automated notifications using Twilio and SMTP providers.

Features include:

* SMS sending
* WhatsApp messaging
* email follow-ups
* delivery status tracking

The backend dynamically generates messages and sends them after call completion or meeting booking.

Technical flow:
Backend event trigger → Notification service → Provider API → Delivery callback → Status update.

---

## 9. Google Meet Scheduling Integration
This module automatically creates Google Meet meetings when candidates confirm date and time.

The backend:

* validates scheduling details
* creates Google Calendar event
* generates Meet link
* stores event metadata
* sends confirmation notifications

The cost exists because OAuth/API integration and calendar event creation require backend workflow management.

Technical flow:
Candidate confirms time → Backend validation → Google Calendar API → Meet link generation → CRM update.

---

## 10. Authentication and Access Control

This module includes:

* login APIs
* JWT token generation
* protected routes
* session validation

This ensures only authorized CRM users can access lead and call data.

Technical flow:
User login → JWT authentication → Protected API access.

---

## 11. Deployment + Nginx Configuration 

This module includes:

* backend deployment
* frontend hosting setup
* Nginx reverse proxy configuration
* webhook routing
* SSL configuration
* production environment setup

This ensures external webhooks securely reach backend APIs.

Technical flow:
Public request → Nginx reverse proxy → FastAPI backend service.

---

## 12. AI Conversation Storage and History Tracking 

This module stores:

* transcripts
* AI-generated responses
* call conversation history
* meeting actions
* follow-up actions

This enables future AI improvement and CRM history visibility.

Technical flow:
Transcript + AI outputs → Conversation collection → CRM timeline rendering.

---


