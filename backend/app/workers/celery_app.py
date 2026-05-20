from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.core.config import settings


celery_app = Celery(
    "crm_workers",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_routes={
        "app.workers.tasks.trigger_outbound_call": {"queue": "call"},
        "app.workers.tasks.schedule_retry_chain": {"queue": "scheduling"},
        "app.workers.tasks.send_whatsapp_followup": {"queue": "notification"},
        "app.workers.tasks.send_notification": {"queue": "notification"},
        "app.workers.tasks.transcribe_call_recording": {"queue": "transcript"},
        "app.workers.tasks.process_due_followups": {"queue": "scheduling"},
    },
    beat_schedule={
        # Check for due follow-ups every minute
        "process-due-followups-every-minute": {
            "task": "app.workers.tasks.process_due_followups",
            "schedule": 60.0,
        },
    },
)
