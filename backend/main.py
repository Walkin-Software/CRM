from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import httpx
from sqlalchemy import text
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from prometheus_fastapi_instrumentator import Instrumentator

from app.core.config import settings
from app.core.database import engine, Base, ensure_database_exists, seed_default_data
from app.core.redis_client import get_redis_client, close_redis_client
from app.api.v1 import auth, leads, notes, follow_ups, users, admin, calls, students, jobs, ai_workflows, notifications, integrations, scheduling, payments, analytics, customers, tickets, visitors, ai_training, copilot
from app.api.v1.calls import set_ngrok_url
from app.core.logger import logger


async def _detect_ngrok_url() -> str | None:
    """Query the local ngrok agent API for the live HTTPS tunnel URL."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get("http://127.0.0.1:4040/api/tunnels", timeout=2.0)
            for tunnel in resp.json().get("tunnels", []):
                if tunnel.get("proto") == "https":
                    return tunnel["public_url"].rstrip("/")
    except Exception:
        pass
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting CRM Service (Local Dev Mode) on port {settings.PORT}")
    await ensure_database_exists()

    ngrok_url = await _detect_ngrok_url()
    if ngrok_url:
        set_ngrok_url(ngrok_url)
    else:
        logger.warning("ngrok tunnel not detected at startup — Twilio speech webhooks will not work until ngrok is running")
    if settings.SENTRY_DSN:
        sentry_sdk.init(
            dsn=settings.SENTRY_DSN,
            environment=settings.ENV,
            integrations=[FastApiIntegration()],
            traces_sample_rate=0.1,
        )

    await get_redis_client()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Backfill columns in existing databases after model expansion.
        def get_columns(sync_conn, table_name):
            from sqlalchemy import inspect
            try:
                inspector = inspect(sync_conn)
                return {col["name"] for col in inspector.get_columns(table_name)}
            except Exception as e:
                logger.warning(f"Error inspecting columns for {table_name}: {e}")
                return set()

        try:
            lead_columns = await conn.run_sync(get_columns, "leads")
            if lead_columns:
                if "lead_type" not in lead_columns:
                    await conn.execute(text("ALTER TABLE leads ADD COLUMN lead_type VARCHAR(20) NOT NULL DEFAULT 'form'"))
                if "job_role" not in lead_columns:
                    await conn.execute(text("ALTER TABLE leads ADD COLUMN job_role VARCHAR(255) NULL"))
                if "years_experience" not in lead_columns:
                    await conn.execute(text("ALTER TABLE leads ADD COLUMN years_experience FLOAT NULL"))
                if "description" not in lead_columns:
                    await conn.execute(text("ALTER TABLE leads ADD COLUMN description TEXT NULL"))
                if "lead_score" not in lead_columns:
                    await conn.execute(text("ALTER TABLE leads ADD COLUMN lead_score INT NOT NULL DEFAULT 0"))
                if "lead_temperature" not in lead_columns:
                    if conn.dialect.name == "mysql":
                        await conn.execute(text("ALTER TABLE leads ADD COLUMN lead_temperature ENUM('hot','warm','cold') NOT NULL DEFAULT 'warm'"))
                    else:
                        await conn.execute(text("ALTER TABLE leads ADD COLUMN lead_temperature VARCHAR(10) NOT NULL DEFAULT 'warm'"))
                if "campaign_id" not in lead_columns:
                    await conn.execute(text("ALTER TABLE leads ADD COLUMN campaign_id VARCHAR(100) NULL"))
                if "utm_source" not in lead_columns:
                    await conn.execute(text("ALTER TABLE leads ADD COLUMN utm_source VARCHAR(120) NULL"))
                if "utm_medium" not in lead_columns:
                    await conn.execute(text("ALTER TABLE leads ADD COLUMN utm_medium VARCHAR(120) NULL"))
                if "utm_campaign" not in lead_columns:
                    await conn.execute(text("ALTER TABLE leads ADD COLUMN utm_campaign VARCHAR(120) NULL"))
                if "keyword" not in lead_columns:
                    await conn.execute(text("ALTER TABLE leads ADD COLUMN keyword VARCHAR(255) NULL"))
                if "conversion_source" not in lead_columns:
                    await conn.execute(text("ALTER TABLE leads ADD COLUMN conversion_source VARCHAR(120) NULL"))
        except Exception as e:
            logger.warning(f"Lead schema backfill skipped or failed: {e}")

        try:
            call_columns = await conn.run_sync(get_columns, "calls")
            if call_columns and "status" in call_columns:
                if conn.dialect.name == "mysql":
                    await conn.execute(
                        text(
                            "ALTER TABLE calls MODIFY COLUMN status "
                            "ENUM('initiated','ringing','in_progress','answered','hangup','no_response','completed','failed','no_answer','busy','transferred') "
                            "NOT NULL DEFAULT 'initiated'"
                        )
                    )
        except Exception as e:
            logger.warning(f"Calls status enum backfill skipped or failed: {e}")

        try:
            audit_columns = await conn.run_sync(get_columns, "audit_logs")
            if audit_columns and "id" in audit_columns:
                if conn.dialect.name == "mysql":
                    # Ensure primary key autoincrement in MySQL deployments.
                    await conn.execute(text("ALTER TABLE audit_logs MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT"))
        except Exception as e:
            logger.warning(f"Audit schema backfill skipped or failed: {e}")
    # Seed default admin user + roles if the database is brand new
    await seed_default_data()

    app.state.client = httpx.AsyncClient()
    yield
    await app.state.client.aclose()
    await close_redis_client()
    await engine.dispose()

app = FastAPI(title="AI Phone Agent — CRM & Dev Proxy", lifespan=lifespan)

if settings.ENABLE_METRICS:
    Instrumentator().instrument(app).expose(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,
)

# ── Core CRM Routes ──────────────────────────────────────────
app.include_router(auth.router,        prefix="/api/auth",        tags=["Auth"])
app.include_router(leads.router,       prefix="/api/leads",       tags=["Leads"])
app.include_router(notes.router,       prefix="/api/leads",       tags=["Notes"])
app.include_router(follow_ups.router,  prefix="/api/leads",       tags=["Follow-ups"])
app.include_router(users.router,       prefix="/api/users",       tags=["Users"])
app.include_router(admin.router,       prefix="/api/admin",       tags=["Admin"])
app.include_router(calls.router,       prefix="/api/calls",       tags=["Calls"])
app.include_router(students.router,    prefix="/api/students",    tags=["Students"])
app.include_router(jobs.router,        prefix="/api/jobs",        tags=["Jobs"])
app.include_router(ai_workflows.router, prefix="/api/ai",         tags=["AI Workflows"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["Notifications"])
app.include_router(integrations.router, prefix="/api/integrations", tags=["Integrations"])
app.include_router(scheduling.router, prefix="/api/scheduling", tags=["Scheduling"])
app.include_router(payments.router,  prefix="/api/payments",  tags=["Payments"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["Analytics"])
app.include_router(customers.router, prefix="/api/customers", tags=["Customers"])
app.include_router(tickets.router,   prefix="/api/tickets",   tags=["Tickets"])
app.include_router(visitors.router,  prefix="/api/visitors",  tags=["Visitors"])
app.include_router(ai_training.router, prefix="/api/ai-training", tags=["AI Training"])
app.include_router(copilot.router,      prefix="/api/copilot",      tags=["AI Copilot"])

# Route aliases for compatibility with frontend
app.include_router(auth.router,        prefix="/auth",        tags=["Auth Alias"])
app.include_router(users.router,       prefix="/users",       tags=["Users Alias"])
app.include_router(admin.router,       prefix="/admin",       tags=["Admin Alias"])
app.include_router(leads.router,       prefix="/leads",       tags=["Leads Alias"])
app.include_router(notes.router,       prefix="/leads",       tags=["Notes Alias"])
app.include_router(follow_ups.router,  prefix="/leads",       tags=["Follow-ups Alias"])
app.include_router(calls.router,       prefix="/calls",       tags=["Calls Alias"])
app.include_router(ai_workflows.router, prefix="/ai",         tags=["AI Alias"])
app.include_router(notifications.router, prefix="/notifications", tags=["Notifications Alias"])
app.include_router(integrations.router, prefix="/integrations", tags=["Integrations Alias"])
app.include_router(scheduling.router, prefix="/scheduling", tags=["Scheduling Alias"])

# ── New module aliases ────────────────────────────────────────
app.include_router(analytics.router,   prefix="/analytics",    tags=["Analytics Alias"])
app.include_router(customers.router,   prefix="/customers",    tags=["Customers Alias"])
app.include_router(tickets.router,     prefix="/tickets",      tags=["Tickets Alias"])
app.include_router(visitors.router,    prefix="/visitors",     tags=["Visitors Alias"])
app.include_router(ai_training.router, prefix="/ai-training",  tags=["AI Training Alias"])
app.include_router(copilot.router,      prefix="/copilot",       tags=["AI Copilot Alias"])

# ── Simple Proxy for other services (Local Development only) ──
# This replaces the need for NGINX/API Gateway during local testing.

SERVICE_MAP = {
    "payments":      "http://localhost:3007",
}

@app.api_route("/{service}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
@app.api_route("/api/{service}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_request(service: str, path: str, request: Request):
    if service not in SERVICE_MAP:
        return JSONResponse({"error": f"Service {service} not found"}, status_code=404)
    
    target_url = f"{SERVICE_MAP[service]}/{service}/{path}"
    
    # Forward headers (excluding host)
    headers = {k: v for k, v in request.headers.items() if k.lower() != 'host'}
    body = await request.body()
    
    try:
        response = await app.state.client.request(
            method=request.method,
            url=target_url,
            headers=headers,
            content=body,
            params=request.query_params,
            timeout=10.0
        )
        return JSONResponse(
            content=response.json() if response.content else None,
            status_code=response.status_code,
            headers={k: v for k, v in response.headers.items() if k.lower() not in ('content-length', 'content-type')}
        )
    except Exception as e:
        logger.error(f"Proxy error to {target_url}: {e}")
        return JSONResponse({"error": "Service unavailable"}, status_code=502)

@app.get("/health")
async def health():
    return {"status": "ok", "mode": "local-dev"}
