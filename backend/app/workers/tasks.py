from __future__ import annotations

from datetime import datetime, timezone
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from app.core.config import settings
from app.core.logger import logger
from app.workers.celery_app import celery_app


def _base_url() -> str:
    if settings.INTERNAL_API_BASE_URL:
        return settings.INTERNAL_API_BASE_URL.rstrip("/")
    # Use http (not https) for localhost to avoid SSL certificate errors
    return f"http://localhost:{settings.PORT}"


def _headers() -> dict[str, str]:
    return {
        "X-Internal-Token": settings.INTERNAL_API_TOKEN,
        "Content-Type": "application/json",
    }


def _post_internal_notification(payload: dict) -> dict:
    response = requests.post(
        f"{_base_url()}/api/notifications/internal/send",
        json=payload,
        headers=_headers(),
        timeout=20,
        verify=False,
    )
    response.raise_for_status()
    return response.json()


@celery_app.task(bind=True, max_retries=0)
def trigger_outbound_call(self, lead_id: str, to_number: str, message: str | None = None):
    payload = {
        "lead_id": lead_id,
        "to_number": to_number,
        "message": message,
    }
    try:
        response = requests.post(
            f"{_base_url()}/api/calls/internal/outbound",
            json=payload,
            headers=_headers(),
            timeout=20,
            verify=False,
        )
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        logger.error(f"trigger_outbound_call failed for lead={lead_id}: {exc}")
        # Do NOT retry — each retry would place a real phone call to the lead
        return {"error": str(exc), "lead_id": lead_id}


@celery_app.task(bind=True, max_retries=2, default_retry_delay=20)
def send_notification(self, lead_id: str, channel: str, to_number: str, body: str):
    payload = {
        "lead_id": lead_id,
        "channel": channel,
        "to": to_number,
        "body": body,
    }
    try:
        return _post_internal_notification(payload)
    except Exception as exc:
        logger.error(f"send_notification failed for lead={lead_id} channel={channel}: {exc}")
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=20)
def send_whatsapp_followup(self, lead_id: str, to_number: str, body: str):
    payload = {
        "lead_id": lead_id,
        "channel": "whatsapp",
        "to": to_number,
        "body": body,
    }
    try:
        return _post_internal_notification(payload)
    except Exception as exc:
        logger.error(f"send_whatsapp_followup failed for lead={lead_id}: {exc}")
        raise self.retry(exc=exc)


@celery_app.task
def schedule_retry_chain(
    lead_id: str,
    to_number: str,
    retry_attempt: int,
    max_attempts: int = 2,
):
    retry_delays = [15 * 60, 2 * 60 * 60]

    if retry_attempt < max_attempts:
        delay = retry_delays[min(retry_attempt, len(retry_delays) - 1)]
        trigger_outbound_call.apply_async(
            args=[lead_id, to_number],
            countdown=delay,
            queue="call",
        )
        return {
            "action": "retry_scheduled",
            "attempt": retry_attempt + 1,
            "delay_seconds": delay,
            "scheduled_at": datetime.now(timezone.utc).isoformat(),
        }

    send_notification.delay(
        lead_id,
        "whatsapp",
        to_number,
        "Hi, we tried reaching you regarding your demo request. Reply with a preferred time and we will call you back.",
    )
    return {
        "action": "whatsapp_followup_queued",
        "attempt": retry_attempt,
    }


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def transcribe_call_recording(self, call_id: str):
    try:
        response = requests.post(
            f"{_base_url()}/api/calls/internal/transcribe/{call_id}",
            headers=_headers(),
            timeout=30,
            verify=False,
        )
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        logger.error(f"transcribe_call_recording failed for call={call_id}: {exc}")
        raise self.retry(exc=exc)


@celery_app.task
def process_due_followups():
    """Beat task: dispatch all follow-ups whose scheduled_at has passed."""
    try:
        response = requests.post(
            f"{_base_url()}/api/leads/internal/process-followups",
            headers=_headers(),
            timeout=30,
            verify=False,
        )
        response.raise_for_status()
        result = response.json()
        logger.info(f"process_due_followups: {result}")
        return result
    except Exception as exc:
        logger.error(f"process_due_followups failed: {exc}")
        return {"error": str(exc)}
