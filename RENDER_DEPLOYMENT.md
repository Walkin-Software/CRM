# Production & Testing Deployment Guide: Render

This guide outlines the step-by-step instructions to deploy both the **Frontend (React/Vite)** and **Backend (FastAPI/Celery)** to **Render** for a testing/staging or production environment, mirroring the local configuration.

---

## 1. Overview of Architecture

The system consists of the following components:
1. **Frontend (Vite / React)**: Deployed as a **Render Static Site** (Free, automated CD, SSL enabled out of the box).
2. **Backend API (FastAPI / Uvicorn)**: Deployed as a **Render Web Service**.
3. **Database (MySQL)**: Since the codebase uses `mysql+aiomysql://` database drivers, a MySQL instance is required. We recommend spinning up a free MySQL instance on a cloud provider like **Aiven.io**, **TiDB Cloud**, or **PlanetScale**, or running a MySQL Docker Container as a Render Private Service.
4. **Redis**: Used as the message broker for Celery tasks. Deployed as a **Render Redis** instance (Free tier available).
5. **Celery Worker**: Deployed as a **Render Background Worker** (uses the same GitHub repository and backend environment, running the Celery command).

---

## 2. Step 1: Deploy Redis (on Render)

1. Sign in to your [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** and select **Redis**.
3. Configure the settings:
   - **Name**: `crm-redis`
   - **Environment**: Select `Free` (or appropriate tier).
   - **Region**: Choose a region close to your target users (e.g., `Singapore` or `Oregon`).
4. Click **Create Redis**.
5. Once created, copy the **Internal Redis URL** (e.g., `redis://red-xxxxxxxxxx:6379`). You will need this for the backend and worker configuration.

---

## 3. Step 2: Set Up MySQL Database

Since Render doesn't offer direct managed MySQL (only PostgreSQL), you have two easy options:

### Option A: External Cloud Provider (Recommended & Free)
Use a cloud database provider like **Aiven.io** or **TiDB Cloud**:
1. Create a free account at [Aiven.io](https://aiven.io/) or [TiDB Cloud](https://pingcap.com/products/tidb-cloud).
2. Create a **MySQL** database instance.
3. Copy the connection string. Make sure it uses `mysql+aiomysql://` for FastAPI's async engine (e.g., `mysql+aiomysql://user:password@host:port/dbname`).

### Option B: Dockerized MySQL as a Render Private Service
1. Create a private service on Render using the official `mysql:8.0` image.
2. Expose port `3306`.
3. Add environment variables:
   - `MYSQL_ROOT_PASSWORD` = `your_secure_root_password`
   - `MYSQL_DATABASE` = `ai_phone_agent`

---

## 4. Step 3: Deploy the FastAPI Backend (Render Web Service)

1. Click **New +** on Render and select **Web Service**.
2. Connect your GitHub repository.
3. Configure the service settings:
   - **Name**: `crm-backend`
   - **Language**: `Python`
   - **Region**: Same region as Redis/MySQL.
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python -m uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Expand the **Environment Variables** section and add the required environment variables:

| Variable Name | Example/Description |
| :--- | :--- |
| `DATABASE_URL` | `mysql+aiomysql://<user>:<pass>@<host>:<port>/<dbname>` |
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
