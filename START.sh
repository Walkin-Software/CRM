#!/bin/bash
# ============================================================
#  START.sh — Start ALL CRM services in this terminal
#  Manages: Redis · MySQL · Backend · Celery Workers · Frontend · ngrok
#  Press Ctrl+C to stop everything cleanly
# ============================================================

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
CERT_DIR="$ROOT_DIR/cert"
LOG_DIR="$ROOT_DIR/.logs"
PIDS_FILE="$ROOT_DIR/.pids"

NGROK_DOMAIN="tabby-fester-rejoin.ngrok-free.dev"
BACKEND_PORT=3003
FRONTEND_PORT=5173

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()      { printf "${GREEN}  ✓${NC}  %s\n" "$1"; }
warn()    { printf "${YELLOW}  ⚠${NC}  %s\n" "$1"; }
info()    { printf "${CYAN}  →${NC}  %s\n" "$1"; }
err()     { printf "${RED}  ✗${NC}  %s\n" "$1"; }
section() { echo ""; printf "${BOLD}${CYAN}──────────────────────────────────────────${NC}\n  ${BOLD}%s${NC}\n${CYAN}──────────────────────────────────────────${NC}\n" "$1"; }

# ── Track a background process PID ──────────────────────────
register_pid() {
  printf "%s:%s\n" "$1" "$2" >> "$PIDS_FILE"
}

# ── Kill all tracked PIDs on exit / Ctrl+C ──────────────────
cleanup() {
  echo ""
  printf "${YELLOW}  Stopping all services...${NC}\n"

  # Stop tail process first
  if [ -n "${TAIL_PID:-}" ] && kill -0 "$TAIL_PID" 2>/dev/null; then
    kill "$TAIL_PID" 2>/dev/null || true
  fi

  if [ -f "$PIDS_FILE" ]; then
    while IFS=: read -r name pid; do
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        printf "    Stopped %-25s (PID %s)\n" "$name" "$pid"
      fi
    done < "$PIDS_FILE"
    rm -f "$PIDS_FILE"
  fi

  # Kill any stray processes still holding our ports
  for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
    stray="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    if [ -n "$stray" ]; then
      kill -9 $stray 2>/dev/null || true
    fi
  done

  echo ""
  printf "${GREEN}  All services stopped.${NC}\n\n"
  exit 0
}

trap cleanup INT TERM

# ── Kill everything from a previous run ─────────────────────
kill_previous() {
  # Kill PIDs tracked from last run
  if [ -f "$PIDS_FILE" ]; then
    while IFS=: read -r name pid; do
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    done < "$PIDS_FILE"
    rm -f "$PIDS_FILE"
  fi

  # Kill anything still on our ports
  for port in "$BACKEND_PORT" "$FRONTEND_PORT" 4040; do
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      kill -9 $pids 2>/dev/null || true
    fi
  done

  # Kill stray celery / ngrok processes from this project
  pkill -9 -f "celery.*celery_app" 2>/dev/null || true
  pkill -9 -f "ngrok http" 2>/dev/null || true

  sleep 1
}

# ── Prepare directories ──────────────────────────────────────
mkdir -p "$LOG_DIR"
kill_previous
touch "$PIDS_FILE"

echo ""
printf "${BOLD}${CYAN}╔══════════════════════════════════════════╗${NC}\n"
printf "${BOLD}${CYAN}║   CRM — Starting All Services            ║${NC}\n"
printf "${BOLD}${CYAN}╚══════════════════════════════════════════╝${NC}\n"

# ── Preflight checks ────────────────────────────────────────
section "Preflight Checks"

if [ ! -f "$CERT_DIR/cert.pem" ] || [ ! -f "$CERT_DIR/key.pem" ]; then
  err "SSL certs missing — run ./INSTALL.sh first"; exit 1
fi
ok "SSL certs found"

if [ ! -f "$BACKEND_DIR/.env" ]; then
  if [ -f "$BACKEND_DIR/.env.example" ]; then
    cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
    ok ".env created from .env.example"
  else
    err "backend/.env missing and no .env.example found"; exit 1
  fi
else
  ok ".env found"
fi

if [ ! -d "$BACKEND_DIR/.venv" ]; then
  err "Python venv missing — run ./INSTALL.sh first"; exit 1
fi
ok "Python venv found"

# Ensure frontend .env points to the backend
if [ ! -f "$FRONTEND_DIR/.env" ]; then
  printf "VITE_API_BASE_URL=https://localhost:%s/api\n" "$BACKEND_PORT" > "$FRONTEND_DIR/.env"
  ok "frontend/.env created"
fi

if ! command -v ngrok &>/dev/null; then
  err "ngrok not installed — run ./INSTALL.sh first"; exit 1
fi
ok "ngrok found"

# Kill anything already on our ports
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  existing="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [ -n "$existing" ]; then
    warn "Port $port already in use (PID $existing) — killing..."
    kill -9 $existing 2>/dev/null || true
    sleep 1
  fi
done

# ── 1. Redis ────────────────────────────────────────────────
section "1 · Redis"
if redis-cli ping &>/dev/null 2>&1; then
  ok "Redis already running"
else
  info "Starting Redis..."
  redis-server \
    --daemonize yes \
    --logfile  "$LOG_DIR/redis.log" \
    --pidfile  "$ROOT_DIR/.redis.pid"
  sleep 1
  redis-cli ping &>/dev/null 2>&1 && ok "Redis started" || { err "Redis failed to start — check $LOG_DIR/redis.log"; exit 1; }
fi

# ── 2. MySQL ────────────────────────────────────────────────
section "2 · MySQL"

# Parse credentials from DATABASE_URL in .env
DB_URL="$(grep '^DATABASE_URL=' "$BACKEND_DIR/.env" | cut -d= -f2- | tr -d '"')"
DB_USER="$(echo "$DB_URL" | sed 's|.*://||; s|:.*||')"
DB_PASS="$(echo "$DB_URL" | sed 's|.*://[^:]*:||; s|@.*||')"
DB_HOST="$(echo "$DB_URL" | sed 's|.*@||; s|:[0-9]*/.*||; s|/.*||')"
DB_PORT="$(echo "$DB_URL" | sed -n 's|.*@[^:]*:\([0-9]*\)/.*|\1|p')"
DB_NAME="$(echo "$DB_URL" | sed 's|.*/||')"
DB_PORT="${DB_PORT:-3306}"

# Locate mysql binary (DMG install or brew)
MYSQL_BIN=""
for candidate in \
    "/usr/local/mysql/bin/mysql" \
    "/usr/local/mysql-9.5.0-macos15-x86_64/bin/mysql" \
    "/opt/homebrew/bin/mysql" \
    "/usr/local/bin/mysql" \
    "$(command -v mysql 2>/dev/null)"; do
  if [ -x "$candidate" ]; then
    MYSQL_BIN="$candidate"
    break
  fi
done

if [ -z "$MYSQL_BIN" ]; then
  warn "mysql binary not found — skipping DB check"
else
  MYSQL_CMD="$MYSQL_BIN -u${DB_USER} -p${DB_PASS} -h${DB_HOST} -P${DB_PORT}"

  # Start MySQL if not reachable (DMG install uses launchctl)
  if ! $MYSQL_CMD -e "SELECT 1" &>/dev/null 2>&1; then
    info "MySQL not responding — attempting to start..."
    sudo /usr/local/mysql/support-files/mysql.server start &>/dev/null 2>&1 || \
    launchctl load -w /Library/LaunchDaemons/com.oracle.oss.mysql.mysqld.plist &>/dev/null 2>&1 || \
    brew services start mysql &>/dev/null 2>&1 || true
    sleep 4
  fi

  if $MYSQL_CMD -e "SELECT 1" &>/dev/null 2>&1; then
    ok "MySQL is running ($(basename "$MYSQL_BIN") at ${DB_HOST}:${DB_PORT})"
    # Create database if it doesn't exist
    if ! $MYSQL_CMD -e "USE \`${DB_NAME}\`" &>/dev/null 2>&1; then
      info "Database '${DB_NAME}' not found — creating..."
      $MYSQL_CMD -e "CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
      ok "Database '${DB_NAME}' created"
    else
      ok "Database '${DB_NAME}' exists"
    fi
  else
    warn "MySQL is not reachable at ${DB_HOST}:${DB_PORT} — backend will fail to connect"
  fi
fi

# ── 3. Backend — FastAPI / uvicorn (HTTPS) ──────────────────
section "3 · Backend — FastAPI HTTPS :$BACKEND_PORT"
cd "$BACKEND_DIR"
source .venv/bin/activate

info "Starting uvicorn..."
python3 -m uvicorn main:app \
  --host 0.0.0.0 \
  --port "$BACKEND_PORT" \
  --reload \
  --ssl-keyfile="$CERT_DIR/key.pem" \
  --ssl-certfile="$CERT_DIR/cert.pem" \
  > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
register_pid "backend" "$BACKEND_PID"
ok "Backend started  (PID $BACKEND_PID)  →  $LOG_DIR/backend.log"

# ── 4. Celery Workers ───────────────────────────────────────
section "4 · Celery Workers"

for queue in call scheduling transcript notification; do
  celery -A app.workers.celery_app.celery_app worker \
    -Q "$queue" \
    --loglevel=info \
    --hostname="${queue}@%h" \
    > "$LOG_DIR/celery-${queue}.log" 2>&1 &
  WPID=$!
  register_pid "celery-${queue}" "$WPID"
  ok "Worker [${queue}]   (PID $WPID)  →  $LOG_DIR/celery-${queue}.log"
done

deactivate 2>/dev/null || true

# ── 5. Frontend — Vite dev server ───────────────────────────
section "5 · Frontend — Vite :$FRONTEND_PORT"
cd "$FRONTEND_DIR"

info "Starting Vite dev server..."
npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
register_pid "frontend" "$FRONTEND_PID"
ok "Frontend started  (PID $FRONTEND_PID)  →  $LOG_DIR/frontend.log"

# ── 6. ngrok tunnel ─────────────────────────────────────────
section "6 · ngrok  →  https://localhost:$BACKEND_PORT"
cd "$ROOT_DIR"

info "Starting ngrok tunnel (static domain: $NGROK_DOMAIN)..."
ngrok http \
  --url="$NGROK_DOMAIN" \
  "https://localhost:$BACKEND_PORT" \
  > "$LOG_DIR/ngrok.log" 2>&1 &
NGROK_PID=$!
register_pid "ngrok" "$NGROK_PID"
ok "ngrok started  (PID $NGROK_PID)  →  $LOG_DIR/ngrok.log"

# ── Allow services to warm up ───────────────────────────────
sleep 3

# ── Service summary ─────────────────────────────────────────
echo ""
printf "${BOLD}${GREEN}╔══════════════════════════════════════════════════════╗${NC}\n"
printf "${BOLD}${GREEN}║   All services are running!                          ║${NC}\n"
printf "${BOLD}${GREEN}╚══════════════════════════════════════════════════════╝${NC}\n"
echo ""
printf "  ${BOLD}Frontend  ${NC}→  https://localhost:$FRONTEND_PORT\n"
printf "  ${BOLD}Backend   ${NC}→  https://localhost:$BACKEND_PORT\n"
printf "  ${BOLD}ngrok     ${NC}→  https://$NGROK_DOMAIN\n"
echo ""
printf "  Logs  →  $LOG_DIR/\n"
printf "  PIDs  →  $PIDS_FILE\n"
echo ""
printf "${YELLOW}  Press Ctrl+C to stop all services${NC}\n"
echo ""
printf "${CYAN}══════════════════════════════════════════ live logs ═══${NC}\n"
echo ""

# ── Stream all logs to this terminal ────────────────────────
tail -f \
  "$LOG_DIR/backend.log" \
  "$LOG_DIR/celery-call.log" \
  "$LOG_DIR/celery-scheduling.log" \
  "$LOG_DIR/celery-transcript.log" \
  "$LOG_DIR/celery-notification.log" \
  "$LOG_DIR/frontend.log" \
  "$LOG_DIR/ngrok.log" \
  2>/dev/null &
TAIL_PID=$!

# ── Stay alive until Ctrl+C ─────────────────────────────────
wait $TAIL_PID 2>/dev/null || true
