#!/usr/bin/env bash
# =====================================================================
# AI Speaking Coach — 启动脚本（由 Agent 驱动，用户无需手动运行）
# 自动：建 venv → 装依赖（core + 已安装能力）→ 指向 UI overlay → 起 FastAPI(8000)
# 用法: bash start.sh [--port N] [--https]
# =====================================================================
set -euo pipefail

SKILL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$SKILL_ROOT/capabilities/conversation-core"
VENV="$SKILL_ROOT/.venv"
PORT="${PORT:-8000}"
HTTPS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2;;
    --https) HTTPS=1; shift;;
    *) shift;;
  esac
done

# 1) Python 版本
PY="$(command -v python3 || true)"
[[ -z "$PY" ]] && { echo "BAD_PY: python3 not found"; exit 1; }
"$PY" -c "import sys; assert sys.version_info>=(3,9), sys.version" || { echo "BAD_PY: need >=3.9"; exit 1; }

# 2) venv
[[ -d "$VENV" ]] || "$PY" -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"

# 3) 依赖：core + 各能力 requirements.txt（若有）
pip install -q --upgrade pip
pip install -q -r "$CORE_DIR/requirements.txt" || \
  pip install -q -r "$CORE_DIR/requirements.txt" -i https://pypi.tuna.tsinghua.edu.cn/simple
for req in "$SKILL_ROOT"/capabilities/*/requirements.txt; do
  [[ -f "$req" && "$req" != "$CORE_DIR/requirements.txt" ]] && pip install -q -r "$req" || true
done

# 4) UI overlay 目录（Path A）：默认指向 skill 内置 UI；可用 WEB_DEMO_DIR 覆盖为部署目录
export WEB_DEMO_DIR="${WEB_DEMO_DIR:-$SKILL_ROOT/scenarios/speaking-coach/ui}"
export PORT="$PORT"

# 5) 起服务（uvicorn；src 作为包，相对导入可用）
cd "$CORE_DIR"
echo "🚀 AI Speaking Coach on http://localhost:$PORT  (WEB_DEMO_DIR=$WEB_DEMO_DIR)"
if [[ "$HTTPS" == "1" ]]; then
  CERT="$SKILL_ROOT/certs/cert.pem"; KEY="$SKILL_ROOT/certs/key.pem"
  if [[ ! -f "$CERT" ]]; then
    mkdir -p "$SKILL_ROOT/certs"
    openssl req -x509 -newkey rsa:2048 -nodes -keyout "$KEY" -out "$CERT" -days 365 \
      -subj "/CN=localhost" >/dev/null 2>&1
  fi
  exec uvicorn src.server:app --host 0.0.0.0 --port "$PORT" \
       --ssl-certfile "$CERT" --ssl-keyfile "$KEY"
else
  exec uvicorn src.server:app --host 0.0.0.0 --port "$PORT"
fi
