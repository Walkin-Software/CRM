# Production & Testing Deployment Guide: Render

This guide outlines the step-by-step instructions to deploy both the **Frontend (React/Vite)** and **Backend (FastAPI/Celery)** to **Render** for a testing/staging or production environment, mirroring the local configuration.

---

## 1. Overview of Architecture

The system consists of the following components:
1. **Frontend (Vite / React)**: Deployed as a **Render Static Site** (Free, automated CD, SSL enabled out of the box).
2. **Backend API (FastAPI / Uvicorn)**: Deployed as a **Render Web Service**.
3. **Database (PostgreSQL / CockroachDB)**: The system supports both PostgreSQL and CockroachDB. We use CockroachDB Serverless (on AWS) for testing and production databases. SQLAlchemy automatically maps the URL to `postgresql+asyncpg://` to connect asynchronously.
4. **Redis**: Used as the message broker for Celery tasks. Deployed as a **Render Redis** instance (Free tier available).
5. **Celery Worker**: Deployed as a **Render Background Worker** (uses the same GitHub repository and backend environment, running the Celery command).

---

## 2. Step 1: Deploy Redis (on Render)

1. Sign in to your [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** and select **Redis**.
3. Configure the settings:
   - **Name**: `crm-redis`
   - **Environment**: Select `Free` (or appropriate tier).
   - **Region**: Choose a region close to your database/server (e.g., `Singapore` or `Oregon`).
4. Click **Create Redis**.
5. Once created, copy the **Internal Redis URL** (e.g., `redis://red-xxxxxxxxxx:6379`). You will need this for the backend and worker configuration.

---

## 3. Step 2: Set Up CockroachDB / PostgreSQL Database

We use CockroachDB Serverless (AWS ap-south-1) for zero-maintenance scaling:
1. In production, configure the database URL exactly as:
   `postgresql://radhe:2Lfn5MGKjoCnh-tIpdXcCQ@crm-ai-28004.j77.aws-ap-south-1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full`
2. The backend code will automatically map this to the async PG driver (`postgresql+asyncpg://`).
3. You do not need to run manual SQL schema scripts; the FastAPI server automatically creates all required tables and seeds default roles and admin users on startup!

---

## 4. Step 3: Deploy the FastAPI Backend (Render Web Service)

1. Click **New +** on Render and select **Web Service**.
2. Connect your GitHub repository.
3. Configure the service settings:
   - **Name**: `crm-backend`
   - **Language**: `Python`
   - **Region**: Same region as Redis/CockroachDB.
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python -m uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Expand the **Environment Variables** section and add the required environment variables:

| Variable Name | Example/Description |
| :--- | :--- |
| `DATABASE_URL` | `postgresql://<user>:<pass>@<host>:<port>/<dbname>` |
| `REDIS_URL` | The **Internal Redis URL** copied from Step 1 |
| `JWT_SECRET` | A secure random string for signing JWT tokens |
| `TWILIO_ACCOUNT_SID` | Your Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Your Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Your Twilio Outbound Phone Number |
| `TWILIO_WEBHOOK_URL` | The URL of this Render Web Service + `/api/calls/webhooks/twilio` (e.g., `https://crm-backend.onrender.com/api/calls/webhooks/twilio`) |
| `OPENAI_API_KEY` | Your OpenAI API key |
| `GROQ_API_KEY` | Your Groq API key (used for fast speech transcription/clarifications) |
| `ALLOWED_ORIGINS` | The URL of your Frontend Render static site (e.g., `https://crm-frontend.onrender.com`) |
| `MOCK_SERVICES` | `false` (set to false to enable real Twilio/OpenAI in production) |

5. Click **Create Web Service**. Tables will be created automatically on startup by SQLAlchemy!

---

## 5. Step 4: Deploy Celery Background Workers

You need a worker process running to handle Twilio calls, text transcripts, and notification scheduling.

1. Click **New +** on Render and select **Background Worker**.
2. Connect the same GitHub repository.
3. Configure the worker settings:
   - **Name**: `crm-celery-worker`
   - **Language**: `Python`
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `celery -A app.workers.celery_app.celery_app worker --loglevel=info`
4. Add the **exact same** Environment Variables configured in the backend (Step 3).
5. Click **Create Background Worker**.

*(Note: Celery will listen to all queues: `call`, `scheduling`, `transcript`, and `notification` automatically when run this way).*

---

## 6. Step 5: Deploy the Frontend (Render Static Site)

1. Click **New +** on Render and select **Static Site**.
2. Connect your GitHub repository.
3. Configure the settings:
   - **Name**: `crm-frontend`
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Publish Directory**: `dist`
4. Add the following **Environment Variables**:

| Variable Name | Value |
| :--- | :--- |
| `VITE_API_BASE_URL` | The public HTTPS URL of your Render backend (e.g., `https://crm-backend.onrender.com`) |
| `VITE_APP_NAME` | `Walkin Software CRM` |

5. Click **Create Static Site**.

---

## 7. Step 6: Configure Twilio Webhook

1. Log in to your [Twilio Console](https://console.twilio.com/).
2. Go to **Phone Numbers** -> **Active Numbers** and click on your active phone number.
3. Under the **Voice & Fax** configuration section, locate **A CALL COMES IN**.
4. Change the dropdown to **Webhook** and paste your backend Render URL:
   `https://crm-backend.onrender.com/api/calls/incoming` (or the respective incoming endpoint configured in `backend/app/api/v1/calls.py`).
5. Set the method to `HTTP POST`.
6. Save the settings.

Your CRM testing environment is now fully deployed and live on Render!
