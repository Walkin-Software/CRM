from __future__ import annotations

from prometheus_client import Counter, Histogram


OUTBOUND_CALLS_TOTAL = Counter(
    "crm_outbound_calls_total",
    "Total outbound calls initiated by CRM",
)

CALL_STATUS_WEBHOOK_TOTAL = Counter(
    "crm_call_status_webhook_total",
    "Total call status webhooks by normalized status",
    ["status"],
)

NOTIFICATION_SEND_TOTAL = Counter(
    "crm_notifications_total",
    "Total notifications attempted by channel and result",
    ["channel", "result"],
)

AI_LATENCY_SECONDS = Histogram(
    "crm_ai_generation_seconds",
    "Latency for AI generation flows",
    buckets=(0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10),
)
