#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "[start.sh] creating venv..."
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt

# 三把钥匙统一放在 capabilities/conversation-core/.env（skill 唯一真源）
CORE_ENV="../../../capabilities/conversation-core/.env"
if [ ! -f "$CORE_ENV" ]; then
  echo "[start.sh] $CORE_ENV not found, copying from .env.example (请去里面填三把钥匙)"
  cp "../../../capabilities/conversation-core/.env.example" "$CORE_ENV"
fi

# 自动生成自签名 HTTPS 证书（TRTC Web SDK 要求 HTTPS 才能采集麦克风/摄像头）
if [ ! -f "cert.pem" ] || [ ! -f "key.pem" ]; then
  echo "[start.sh] generating self-signed TLS cert (cert.pem / key.pem) ..."
  openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes \
    -subj "/CN=localhost" 2>/dev/null || {
      echo "[start.sh] WARNING: openssl 生成证书失败，将以 HTTP 模式启动（只能用 localhost 访问）"
    }
fi

python3 -m app.server
