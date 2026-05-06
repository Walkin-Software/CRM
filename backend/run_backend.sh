#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

PORT="${CRM_SERVICE_PORT:-3003}"
HOST="${BACKEND_HOST:-0.0.0.0}"

echo "Starting backend from $ROOT_DIR on $HOST:$PORT"

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi

source .venv/bin/activate

echo "Installing/updating dependencies..."
pip install --upgrade pip >/dev/null
pip install -r requirements.txt >/dev/null

# Stop existing process on selected backend port.
EXISTING_PID="$(lsof -ti tcp:"$PORT" || true)"
if [ -n "$EXISTING_PID" ]; then
  echo "Stopping existing process on port $PORT (pid: $EXISTING_PID)"
  kill -9 $EXISTING_PID
fi

CERT_DIR="$(cd "$ROOT_DIR/.." && pwd)/cert"

echo "Launching FastAPI backend with HTTPS..."
echo "Using SSL certificates from $CERT_DIR"
exec python3 -m uvicorn main:app --host "$HOST" --port "$PORT" --reload --ssl-keyfile="$CERT_DIR/key.pem" --ssl-certfile="$CERT_DIR/cert.pem"
