# AI Calling CRM Platform — Implementation Plan

## 1. Queue System — Redis + Celery

**Will be implemented:** Yes

**Where:** Backend worker services — outbound call scheduling, retry flows, notification dispatch, transcript processing

**Why:**
All task scheduling and background jobs will be handled through a persistent queue system using Redis as the broker and Celery as the task runner. This ensures that scheduled calls, retries, and follow-ups are not lost if the server restarts or crashes. Every task is written to disk before execution, making the system production-safe and recoverable.

**Tools:**
- Redis — Task broker and queue storage
- Celery — Distributed task worker

---

## 2. Hybrid AI Logic

**Will be implemented:** Yes

**Where:** Call conversation engine, FAQ handling layer, intent routing

**Why:**
Not every question a lead asks requires a full OpenAI API call. Common questions around fees, course details, placement records, and timelines will be handled by a rule-based engine with pre-defined responses. OpenAI will only be invoked for complex, open-ended, or unrecognized inputs. This significantly reduces AI cost per call while keeping response times fast.

**Approach:**
- Tier 1: Rule-based engine for FAQs and known intents
- Tier 2: OpenAI GPT for complex or unmatched queries
- Result: Lower token usage, faster responses, reduced cost per conversation

---

## 3. Smart Retry Logic

**Will be implemented:** Yes

**Where:** Call worker, queue system, WhatsApp/SMS notification service

**Why:**
A single unanswered call is not the end of a lead. The retry flow will be queue-driven so that every missed call automatically triggers a retry sequence without any manual intervention.

**Retry Flow:**
```
1st Call → No Answer
    → Retry after 15 minutes
    → Retry after 2 hours
    → WhatsApp follow-up message if still no response
```

**Why Queue for This:**
Retry scheduling must survive server restarts. Using an in-memory sleep is not production-safe. Queue-based retries are persistent, trackable, and cancellable.

---

## 4. Cached AI Responses

**Will be implemented:** Yes

**Where:** AI content service, FAQ response layer

**Why:**
Responses to repeated questions — fees, course duration, placement statistics, EMI options — are the same for every lead. Fetching these from OpenAI every time wastes tokens and adds latency. These responses will be cached in Redis with a configurable TTL (time-to-live). Cache will be invalidated automatically when the source data changes.

**Tools:**
- Redis — Response cache with TTL

**Result:** 60–80% reduction in redundant AI API calls for common queries

---

## 5. Telephony Provider

**Will be implemented:** Yes (Twilio as primary)

**Where:** Call service, outbound dialer, WhatsApp integration

**Why:**
Twilio will serve as the global telephony provider for calls, SMS, and WhatsApp. 

**Tools:**
- Twilio — Global calls, SMS, WhatsApp
---

## 6. Worker Service Separation

**Will be implemented:** Yes

**Where:** Backend architecture — separate processes per concern

**Why:**
Running all logic in a single application process creates a single point of failure. If the transcript service is slow, it should not block the API from responding. Each worker will run as an independent process that can be scaled, restarted, and monitored independently.

**Workers to be created:**
| Worker | Responsibility |
|--------|---------------|
| API Service | Handles all HTTP requests |
| AI Worker | Generates AI responses, screening questions |
| Call Worker | Manages outbound/inbound call orchestration |
| Transcript Worker | Post-call transcription processing |
| Notification Worker | SMS, Email, WhatsApp delivery |
| Scheduling Worker | Delayed calls, retry scheduling |

---

## 7. Webhook Architecture

**Will be implemented:** Yes

**Where:** Call service, notification service, recording pipeline

**Why:**
Instead of polling for updates (e.g., "has the call ended?", "has the SMS been delivered?"), webhooks allow third-party services like Twilio and AssemblyAI to push status updates in real time. This removes polling overhead and keeps the system event-driven.

**Webhooks to be implemented:**
- Call status updates (answered, completed, failed, busy)
- Recording availability notifications
- SMS/WhatsApp delivery status
- Transcription completion events

---

## 8. Post-Call Transcript Strategy

**Will be implemented:** Yes

**Where:** Transcript Worker, called after Twilio call completion webhook fires

**Why:**
Generating a transcript during a live call is expensive and adds latency to the conversation. Transcription will be triggered only after the call ends — this reduces cost, avoids interference with the live call, and ensures the full audio is available for accurate transcription.

**Flow:**
```
Call ends → Twilio webhook fires → Transcript Worker picks up job
→ Fetches recording → Sends to AssemblyAI → Stores transcript
→ Triggers post-call follow-up workflow
```

**Tools:**
- AssemblyAI — Speech-to-text transcription

---

## 9. Lead Scoring System

**Will be implemented:** Yes

**Where:** Lead model (database), CRM dashboard, call outcome processing

**Why:**
Not all leads are equal. After each call interaction, the system will automatically assign a score based on engagement signals — responses given, interest expressed, questions asked, demo booked or declined. This allows the sales team to prioritize hot leads and avoid wasting call capacity on cold ones.

**Categories:**
| Category | Criteria |
|----------|---------|
| Hot | Responded positively, asked questions, booked demo |
| Warm | Responded but undecided, asked to call back |
| Cold | No answer multiple times, declined, unresponsive |

**Implementation:**
- `lead_score` and `lead_temperature` fields added to Lead model
- Score auto-updated after every call outcome
- Dashboard filter by Hot / Warm / Cold

---

## 10. AI Memory Layer

**Will be implemented:** Yes 

**Where:** Conversation service, lead context engine

**Why:**
Currently, every call to a lead starts with zero context from previous interactions. The AI memory layer will store embeddings (vector representations) of past conversations and retrieve relevant context before each new call. This allows the AI to say "Last time you mentioned concerns about placement — let me address that" instead of repeating the same script.

**Tools:**
- pgvector — PostgreSQL extension for vector storage and semantic search (free, no external dependency)

**Result:** Smarter, personalized follow-ups.

---

## 11. Campaign Attribution

**Will be implemented:** Yes

**Where:** Lead creation flow, web form ingestion, social media integrations

**Why:**
To know which marketing campaigns are generating quality leads, every lead must carry attribution data from the moment it enters the system. This enables ROI tracking per campaign — if Google Ads campaign X generates 100 leads but only 2 convert, and campaign Y generates 40 leads with 15 conversions, budget should shift to Y.

**Fields to be added to Lead model:**
- `campaign_id`
- `utm_source`
- `utm_medium`
- `utm_campaign`
- `keyword`
- `conversion_source`

---

## 12. Monitoring & Observability

**Will be implemented:** Yes

**Where:** Backend application, infrastructure, CI/CD pipeline

**Why:**
Without monitoring, failures are discovered by users before the team. Production systems require real-time visibility into errors, latency, failed calls, and AI response times. The monitoring stack will track all key metrics and alert the team before issues escalate.

**Tools:**
| Tool | Purpose |
|------|---------|
| Prometheus | Metrics collection — API latency, call failure rates, AI response times |
| Grafana | Visual dashboards for all metrics |
| Sentry | Real-time error tracking and alerting |

**Metrics to track:**
- Failed calls per hour
- AI response latency (ms)
- Webhook delivery failures
- Queue depth and processing lag
- Lead conversion rate over time

---


## Tools Not Required (Excluded with Reason)

| Tool | Reason Not Required |
|------|-------------------|
| **RabbitMQ** | Redis alone can serve as the Celery message broker at our scale. RabbitMQ adds operational complexity with no benefit at this stage. |
| **Pinecone (immediate)** | pgvector is free and runs inside our existing database. Pinecone is a paid external service that adds dependency. Will only be considered if vector search volume exceeds pgvector's capacity. |
| **Predictive ML Scoring (now)** | Requires a trained model and sufficient historical call data. Will be introduced once enough conversion data is collected. |
| **Autonomous AI Agents (now)** | Requires stable core platform first. Planned for future phase after all base features are live and tested. |

---

## Recommended Implementation Priority

| Priority | Feature | Reason |
|----------|---------|--------|
| 1 | Queue System (Redis + Celery) | Production safety — prevents data loss on server restart |
| 2 | Hybrid AI Logic | Immediate cost reduction on every call |
| 3 | Smart Retry Logic | Higher lead pickup rate without extra cost |
| 4 | Monitoring Stack | Visibility before going live in production |
| 5 | Lead Scoring | Prioritization for sales team efficiency |
| 6 | Campaign Attribution | Marketing ROI tracking |
| 7 | Worker Separation | Scalability and fault isolation |
| 8 | Cached AI Responses | Latency and cost reduction |
| 9 | AI Memory Layer | Smarter conversations (Phase 2) |

---

## Budget Note (Local Development)

Based on the expanded scope, the revised development quote is **INR 80,000**.

### Why the quote is revised to 80k
- Scope now includes queue-driven architecture (Redis + Celery) instead of basic synchronous flows.
- Retry engine requires timed orchestration (15 min, 2 hr, WhatsApp follow-up) with failure-safe handling.
- AI cost optimization work adds hybrid logic + caching layer design and integration.
- Worker separation introduces additional development and testing effort across multiple services.
- Lead scoring + campaign attribution require database updates, APIs, and CRM-side integration.
- Monitoring hooks and AI memory preparation add foundational engineering for scale-readiness.

This pricing is for **local development implementation** only.


