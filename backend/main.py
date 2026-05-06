from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import httpx
from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine, Base
from app.api.v1 import auth, leads, notes, follow_ups, users, admin, calls, students, jobs, ai_workflows, notifications, integrations, scheduling
from app.core.logger import logger

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting CRM Service (Local Dev Mode) on port {settings.PORT}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Backfill columns in existing databases after model expansion.
        try:
            lead_columns = {
                row[0]
                for row in (
                    await conn.execute(text("SHOW COLUMNS FROM leads"))
                ).fetchall()
            }
            if "lead_type" not in lead_columns:
                await conn.execute(text("ALTER TABLE leads ADD COLUMN lead_type VARCHAR(20) NOT NULL DEFAULT 'form'"))
            if "job_role" not in lead_columns:
                await conn.execute(text("ALTER TABLE leads ADD COLUMN job_role VARCHAR(255) NULL"))
            if "years_experience" not in lead_columns:
                await conn.execute(text("ALTER TABLE leads ADD COLUMN years_experience FLOAT NULL"))
        except Exception as e:
            logger.warning(f"Lead schema backfill skipped or failed: {e}")

        try:
            call_columns = {
                row[0]
                for row in (
                    await conn.execute(text("SHOW COLUMNS FROM calls"))
                ).fetchall()
            }
            if "status" in call_columns:
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
            audit_columns = {
                row[0]
                for row in (
                    await conn.execute(text("SHOW COLUMNS FROM audit_logs"))
                ).fetchall()
            }
            if "id" in audit_columns:
                # Ensure primary key autoincrement in MySQL deployments.
                await conn.execute(text("ALTER TABLE audit_logs MODIFY COLUMN id BIGINT NOT NULL AUTO_INCREMENT"))
        except Exception as e:
            logger.warning(f"Audit schema backfill skipped or failed: {e}")
    app.state.client = httpx.AsyncClient()
    yield
    await app.state.client.aclose()
    await engine.dispose()

app = FastAPI(title="AI Phone Agent — CRM & Dev Proxy", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
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

# ── Simple Proxy for other services (Local Development only) ──
# This replaces the need for NGINX/API Gateway during local testing.

SERVICE_MAP = {
    "analytics":     "http://localhost:3006",
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
