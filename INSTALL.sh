#!/bin/bash
# ============================================================
#  INSTALL.sh — Install project dependencies
#  · Backend: Python venv + pip packages
#  · Frontend: npm packages
# ============================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()      { printf "${GREEN}  ✓${NC}  %s\n" "$1"; }
info()    { printf "${CYAN}  →${NC}  %s\n" "$1"; }
section() { echo ""; printf "${BOLD}${CYAN}──── %s ────${NC}\n" "$1"; }

echo ""
printf "${BOLD}${CYAN}╔══════════════════════════════════════════╗${NC}\n"
printf "${BOLD}${CYAN}║   CRM — Installing Dependencies          ║${NC}\n"
printf "${BOLD}${CYAN}╚══════════════════════════════════════════╝${NC}\n"

# ── Backend: Python venv + pip ───────────────────────────────
section "Backend — Python venv + requirements.txt"
cd "$BACKEND_DIR"

if [ ! -d ".venv" ]; then
  info "Creating Python virtual environment..."
  python3 -m venv .venv
  ok "venv created"
else
  ok "venv already exists"
fi

info "Activating venv and upgrading pip..."
source .venv/bin/activate
pip install --upgrade pip -q
info "Installing requirements.txt..."
pip install -r requirements.txt
ok "Python packages installed"
deactivate

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp .env.example .env
  ok ".env created from .env.example"
fi

# ── Frontend: npm install ────────────────────────────────────
section "Frontend — npm install"
cd "$FRONTEND_DIR"
info "Running npm install..."
npm install
ok "Frontend packages installed"

# ── Done ─────────────────────────────────────────────────────
echo ""
printf "${BOLD}${GREEN}╔══════════════════════════════════════════╗${NC}\n"
printf "${BOLD}${GREEN}║  ✓  All dependencies installed!          ║${NC}\n"
printf "${BOLD}${GREEN}╚══════════════════════════════════════════╝${NC}\n"
echo ""
echo "  Run ./START.sh to launch all services."
echo ""
