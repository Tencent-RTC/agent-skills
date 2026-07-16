#!/usr/bin/env bash
# =====================================================================
# conversation-core 独立启动脚本（Path B 端到端验证用）
#
# 只拉起骨架服务（conversation-core + 已安装的能力包路由），不含任何场景 UI。
# Path A 的完整体验 demo 请用 scenarios/meeting-interpreter/backend/start.sh。
#
# 用法：
#   ./start.sh                  # HTTP 启动（默认端口 8020）
#   ./start.sh --port 8080      # 自定义端口
#   ./start.sh --rebuild        # 强制重建 venv
# =====================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CORE_DIR="$SCRIPT_DIR/capabilities/conversation-core"
ENV_FILE="$CORE_DIR/.env"
REQUIREMENTS="$CORE_DIR/requirements.txt"
VENV_DIR="$SCRIPT_DIR/.venv"
MIN_PY_MAJOR=3; MIN_PY_MINOR=9
PORT=8020; REBUILD=0

if [ -t 1 ]; then
    GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
else GREEN=''; YELLOW=''; RED=''; CYAN=''; NC=''; fi
log()  { printf "${CYAN}[%s]${NC} %s\n" "$(date +%H:%M:%S)" "$*"; }
ok()   { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}⚠${NC}  %s\n" "$*"; }
die()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --rebuild) REBUILD=1 ;;
        --port)    shift; PORT="$1" ;;
        --help|-h) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) warn "忽略未知参数: $1" ;;
    esac
    shift
done

[ -f "$ENV_FILE" ] || die ".env not found: $ENV_FILE\n  请先按 SKILL.md 完成三把钥匙配置；\n  或手动: cp $CORE_DIR/.env.example $ENV_FILE 后填写"

PY_CMD=""
for cand in python3.12 python3.11 python3.10 python3.9 python3 python; do
    if command -v "$cand" >/dev/null 2>&1; then
        VER=$("$cand" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "0.0")
        MAJOR=$(echo "$VER" | cut -d. -f1); MINOR=$(echo "$VER" | cut -d. -f2)
        if [ "$MAJOR" -gt "$MIN_PY_MAJOR" ] || { [ "$MAJOR" -eq "$MIN_PY_MAJOR" ] && [ "$MINOR" -ge "$MIN_PY_MINOR" ]; }; then
            PY_CMD="$cand"; ok "Python $VER -> $(command -v "$cand")"; break
        fi
    fi
done
[ -z "$PY_CMD" ] && die "未检测到 Python >= ${MIN_PY_MAJOR}.${MIN_PY_MINOR}"

[ "$REBUILD" -eq 1 ] && [ -d "$VENV_DIR" ] && { warn "重建 venv..."; rm -rf "$VENV_DIR"; }
NEED_INSTALL=0
if [ ! -d "$VENV_DIR" ]; then
    log "创建虚拟环境..."
    "$PY_CMD" -m venv "$VENV_DIR" || die "venv 创建失败（Linux 可能需要: apt install python3-venv）"
    NEED_INSTALL=1
fi
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
VENV_PY="$VENV_DIR/bin/python"; VENV_PIP="$VENV_DIR/bin/pip"

[ "$NEED_INSTALL" -eq 0 ] && ! "$VENV_PY" -c "import fastapi, uvicorn, requests, dotenv, pydantic" 2>/dev/null && NEED_INSTALL=1
if [ "$NEED_INSTALL" -eq 1 ]; then
    log "安装依赖..."
    "$VENV_PIP" install --upgrade pip >/dev/null 2>&1 || true
    if "$VENV_PIP" install -r "$REQUIREMENTS" -i "https://pypi.tuna.tsinghua.edu.cn/simple" --timeout 15 >/dev/null 2>&1; then
        ok "依赖安装完成（清华镜像）"
    else
        warn "镜像源失败，切换官方源..."
        "$VENV_PIP" install -r "$REQUIREMENTS" >/dev/null || die "依赖安装失败"
        ok "依赖安装完成（官方源）"
    fi
else ok "依赖已就位"; fi

printf "%b🚀 启动 conversation-core: http://localhost:%s%b (Ctrl+C 停止)\n" "$GREEN" "$PORT" "$NC"

cd "$CORE_DIR"
export HOST="${HOST:-0.0.0.0}"; export PORT="$PORT"
exec "$VENV_PY" -m uvicorn src.server:app --host "$HOST" --port "$PORT"
