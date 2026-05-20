"""
Application Configuration — Pydantic Settings
Reads from environment variables / .env file.
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from functools import lru_cache
from typing import List


class Settings(BaseSettings):
    # ── App ──────────────────────────────────────────────────
    ENV: str = Field("development", env="NODE_ENV")
    PORT: int = Field(3003, env="CRM_SERVICE_PORT")
    LOG_LEVEL: str = Field("info", env="LOG_LEVEL")

    # ── MySQL ─────────────────────────────────────────────────
    DATABASE_URL: str = Field(
        "mysql+aiomysql://root:radhe123@localhost:3306/ai_phone_agent",
        env="DATABASE_URL"
    )
    DB_POOL_SIZE: int = Field(10, env="DB_POOL_SIZE")

    # ── Redis ─────────────────────────────────────────────────
    REDIS_URL: str = Field("redis://localhost:6379", env="REDIS_URL")
    REDIS_TTL: int = Field(3600, env="REDIS_TTL_SECONDS")
    DASHBOARD_CACHE_TTL_SECONDS: int = Field(60, env="DASHBOARD_CACHE_TTL_SECONDS")

    # ── Queue / Workers ───────────────────────────────────────
    CELERY_BROKER_URL: str = Field("redis://localhost:6379/0", env="CELERY_BROKER_URL")
    CELERY_RESULT_BACKEND: str = Field("redis://localhost:6379/1", env="CELERY_RESULT_BACKEND")
    INTERNAL_API_TOKEN: str = Field("local-internal-token", env="INTERNAL_API_TOKEN")
    INTERNAL_API_BASE_URL: str = Field("", env="INTERNAL_API_BASE_URL")

    # ── JWT ───────────────────────────────────────────────────
    JWT_SECRET: str = Field("change-me-in-production", env="JWT_SECRET")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRES_MINUTES: int = 60
    JWT_REFRESH_EXPIRES_DAYS: int = 7

    # ── CORS ──────────────────────────────────────────────────
    ALLOWED_ORIGINS: List[str] = Field(
        default=["http://localhost:5173", "https://localhost:5173", "http://localhost:3000"],
        env="ALLOWED_ORIGINS",
    )

    # ── AI / Integrations ─────────────────────────────────────
    OPENAI_API_KEY: str = Field("", env="OPENAI_API_KEY")
    OPENAI_MODEL: str = Field("gpt-4o-mini", env="OPENAI_MODEL")
    OPENAI_EMBEDDING_MODEL: str = Field("text-embedding-3-small", env="OPENAI_EMBEDDING_MODEL")
    OPENAI_TTS_MODEL: str = Field("tts-1", env="OPENAI_TTS_MODEL")
    OPENAI_TTS_VOICE: str = Field("nova", env="OPENAI_TTS_VOICE")
    COMPANY_DESCRIPTION: str = Field("", env="COMPANY_DESCRIPTION")
    GROQ_API_KEY: str = Field("", env="GROQ_API_KEY")
    GROQ_MODEL: str = Field("llama-3.3-70b-versatile", env="GROQ_MODEL")
    ASSEMBLYAI_API_KEY: str = Field("", env="ASSEMBLYAI_API_KEY")
    ASSEMBLYAI_API_BASE_URL: str = Field("https://api.assemblyai.com/v2", env="ASSEMBLYAI_API_BASE_URL")
    ASSEMBLYAI_SPEECH_MODEL: str = Field("universal-2", env="ASSEMBLYAI_SPEECH_MODEL")
    ASSEMBLYAI_POLL_INTERVAL_SECONDS: float = Field(2.0, env="ASSEMBLYAI_POLL_INTERVAL_SECONDS")
    ASSEMBLYAI_TRANSCRIPT_TIMEOUT_SECONDS: int = Field(180, env="ASSEMBLYAI_TRANSCRIPT_TIMEOUT_SECONDS")
    ASSEMBLYAI_REALTIME_WS_URL: str = Field("wss://agents.assemblyai.com/v1/ws", env="ASSEMBLYAI_REALTIME_WS_URL")
    ASSEMBLYAI_REALTIME_VOICE: str = Field("ivy", env="ASSEMBLYAI_REALTIME_VOICE")
    REALTIME_CALLS_ENABLED: bool = Field(False, env="REALTIME_CALLS_ENABLED")
    AI_MEMORY_ENABLED: bool = Field(False, env="AI_MEMORY_ENABLED")
    MOCK_SERVICES: bool = Field(True, env="MOCK_SERVICES")

    # ── Observability ─────────────────────────────────────────
    ENABLE_METRICS: bool = Field(True, env="ENABLE_METRICS")
    SENTRY_DSN: str = Field("", env="SENTRY_DSN")

    # ── Twilio ─────────────────────────────────────────────────
    TWILIO_ACCOUNT_SID: str = Field("", env="TWILIO_ACCOUNT_SID")
    TWILIO_API_KEY: str = Field("", env="TWILIO_API_KEY")
    TWILIO_API_SECRET: str = Field("", env="TWILIO_API_SECRET")
    TWILIO_AUTH_TOKEN: str = Field("", env="TWILIO_AUTH_TOKEN")
    TWILIO_PHONE_NUMBER: str = Field("", env="TWILIO_PHONE_NUMBER")
    TWILIO_WHATSAPP_NUMBER: str = Field("", env="TWILIO_WHATSAPP_NUMBER")
    TWILIO_WEBHOOK_URL: str = Field("", env="TWILIO_WEBHOOK_URL")

    # ── Google Calendar / Meet ─────────────────────────────────
    GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON: str = Field("", env="GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON")
    GOOGLE_CALENDAR_ID: str = Field("primary", env="GOOGLE_CALENDAR_ID")

    # ── Stripe ─────────────────────────────────────────────────
    STRIPE_SECRET_KEY: str = Field("", env="STRIPE_SECRET_KEY")
    STRIPE_WEBHOOK_SECRET: str = Field("", env="STRIPE_WEBHOOK_SECRET")

    # ── SMTP ───────────────────────────────────────────────────
    SMTP_HOST: str = Field("", env="SMTP_HOST")
    SMTP_PORT: int = Field(587, env="SMTP_PORT")
    SMTP_USER: str = Field("", env="SMTP_USER")
    SMTP_PASS: str = Field("", env="SMTP_PASS")
    SMTP_FROM: str = Field("", env="SMTP_FROM")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
