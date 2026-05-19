from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import engine, Base, ensure_database_exists
from app.core.logger import logger
from app.api.v1.ai_integration import router as ai_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting CRM AI Service on port {settings.PORT}")
    await ensure_database_exists()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(title="CRM AI Service — Screening & Follow-up", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,
)

app.include_router(ai_router, prefix="/ai", tags=["AI Screening"])
app.include_router(ai_router, prefix="/api/ai", tags=["AI Screening API"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "crm-ai"}
