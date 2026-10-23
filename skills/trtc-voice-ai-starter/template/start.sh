#!/usr/bin/env bash
# =============================================================
# TRTC Voice AI Starter Kit — start script
#
# Usage:
#   ./start.sh           Start web (port 5173) + server (port 3000)
#   ./start.sh --check   Environment check only — no services started
# =============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CHECK_ONLY=0
while [ $# -gt 0 ]; do
    case "$1" in
        --check) CHECK_ONLY=1 ;;
        --help|-h) sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown argument: $1" ;;
    esac
    shift
done

# Colors (disabled when not a TTY)
if [ -t 1 ]; then
    GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
else GREEN=''; YELLOW=''; RED=''; CYAN=''; NC=''; fi
ok()   { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}⚠${NC}  %s\n" "$*"; }
die()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }
log()  { printf "${CYAN}[%s]${NC} %s\n" "$(date +%H:%M:%S)" "$*"; }

# ---- Check Node.js ≥ 18 ------------------------------------
if ! command -v node >/dev/null 2>&1; then
    die "Node.js not found. Install v18 or above from https://nodejs.org/"
fi
NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
    die "Node.js $NODE_MAJOR detected — version 18 or above is required."
fi
ok "Node.js $(node --version)"

# ---- Check pnpm --------------------------------------------
if ! command -v pnpm >/dev/null 2>&1; then
    die "pnpm not found. Install with: npm install -g pnpm"
fi
ok "pnpm $(pnpm --version)"

# ---- Check .env --------------------------------------------
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    die ".env not found. Copy .env.example to .env and fill in your credentials."
fi
ok ".env found"

# ---- Exit here if --check ----------------------------------
if [ "$CHECK_ONLY" -eq 1 ]; then
    ok "Environment check passed"
    exit 0
fi

# ---- Install dependencies if needed ------------------------
if [ ! -d "$SCRIPT_DIR/node_modules" ] || \
   [ ! -d "$SCRIPT_DIR/server/node_modules" ] || \
   [ ! -d "$SCRIPT_DIR/web/node_modules" ]; then
    log "Installing dependencies (first run may take a minute)..."
    pnpm install
fi

# ---- Start -------------------------------------------------
log "Starting server (port 3000) + web (port 5173)..."
printf "\n  Voice agent:  ${GREEN}http://localhost:5173${NC}\n"
printf "  API docs:     ${GREEN}http://localhost:3000/docs${NC}\n"
printf "  Health probe: ${GREEN}http://localhost:3000/health${NC}\n\n"

exec pnpm run start
