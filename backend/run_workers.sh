#!/usr/bin/env bash
set -euo pipefail

# Start dedicated worker processes for each queue.
celery -A app.workers.celery_app.celery_app worker -Q call --loglevel=info --hostname=call@%h &
celery -A app.workers.celery_app.celery_app worker -Q scheduling --loglevel=info --hostname=scheduling@%h &
celery -A app.workers.celery_app.celery_app worker -Q transcript --loglevel=info --hostname=transcript@%h &
celery -A app.workers.celery_app.celery_app worker -Q notification --loglevel=info --hostname=notification@%h &

wait
