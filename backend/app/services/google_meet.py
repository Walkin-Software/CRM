"""
Google Calendar + Meet integration.

Requires a Google service account JSON (set GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON in .env)
with Calendar API access and domain-wide delegation, OR a personal OAuth2 credential.

If credentials are not configured, create_google_meet_link returns None and the booking
proceeds without a meeting link.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Optional

from app.core.config import settings
from app.core.logger import logger


async def create_google_meet_link(
    *,
    title: str,
    description: str,
    starts_at: datetime,
    ends_at: datetime,
    organizer_email: str | None = None,
    attendee_email: str | None = None,
) -> Optional[str]:
    """Create a Google Calendar event with a Meet link.

    Returns the Google Meet URL on success, or None if credentials are not
    configured or the API call fails.
    """
    sa_json = (settings.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON or "").strip()
    calendar_id = (settings.GOOGLE_CALENDAR_ID or "primary").strip()

    if not sa_json:
        logger.debug("Google Calendar credentials not configured — skipping Meet link creation")
        return None

    try:
        from googleapiclient.discovery import build
        from google.oauth2 import service_account
        import asyncio

        sa_info = json.loads(sa_json)
        scopes = ["https://www.googleapis.com/auth/calendar"]

        credentials = service_account.Credentials.from_service_account_info(sa_info, scopes=scopes)
        if organizer_email:
            credentials = credentials.with_subject(organizer_email)

        def _build_event() -> str:
            service = build("calendar", "v3", credentials=credentials, cache_discovery=False)
            event_body = {
                "summary": title,
                "description": description,
                "start": {
                    "dateTime": starts_at.isoformat(),
                    "timeZone": "UTC",
                },
                "end": {
                    "dateTime": ends_at.isoformat(),
                    "timeZone": "UTC",
                },
                "conferenceData": {
                    "createRequest": {
                        "requestId": str(uuid.uuid4()),
                        "conferenceSolutionKey": {"type": "hangoutsMeet"},
                    }
                },
            }
            if attendee_email:
                event_body["attendees"] = [{"email": attendee_email}]

            created = service.events().insert(
                calendarId=calendar_id,
                body=event_body,
                conferenceDataVersion=1,
                sendUpdates="all" if attendee_email else "none",
            ).execute()

            conference = created.get("conferenceData", {})
            entry_points = conference.get("entryPoints", [])
            for ep in entry_points:
                if ep.get("entryPointType") == "video":
                    return ep.get("uri", "")
            return created.get("htmlLink", "")

        meet_url = await asyncio.to_thread(_build_event)
        if meet_url:
            logger.info(f"Google Meet link created: {meet_url}")
        return meet_url or None

    except ImportError:
        logger.warning(
            "google-api-python-client not installed. "
            "Run: pip install google-api-python-client google-auth"
        )
        return None
    except Exception as exc:
        logger.error(f"Google Meet creation failed: {exc}")
        return None
