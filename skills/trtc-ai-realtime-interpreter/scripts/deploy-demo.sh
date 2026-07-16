#!/usr/bin/env bash
# 将 Path A Demo 部署到独立目录并在 Demo 目录内构建前端（Skill 目录不产生任何构建产物）
# 用法: bash scripts/deploy-demo.sh <PROJECT_ROOT>
# 前置: .env 已配置三把钥匙 + Node.js >= 16 + npm
# 输出: 成功打印 "DEPLOY_OK: <demo_dir>"，失败打印 "DEPLOY_FAIL: <reason>" 并 exit 1
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="${1:-$(pwd)}"
DEMO_DIR="$PROJECT_ROOT/ai-interpreter-demo"

# 1. 检查 Node.js + npm
if ! command -v node &>/dev/null; then
  echo "DEPLOY_FAIL: Node.js 未安装。请先安装 Node.js >= 16 (https://nodejs.org/)"
  exit 1
fi
if ! command -v npm &>/dev/null; then
  echo "DEPLOY_FAIL: npm 未安装。请先安装 npm (通常随 Node.js 一起安装)"
  exit 1
fi

# 2. 检查 .env 是否已配置
ENV_FILE="$SKILL_ROOT/capabilities/conversation-core/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "DEPLOY_FAIL: .env 未配置，请先配置三把钥匙"
  exit 1
fi

# 3. 清理旧部署并创建目录结构
echo "[deploy-demo] deploying to $DEMO_DIR ..."
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR/scenarios/meeting-interpreter"

# 4. 拷贝 capabilities（含 .env）
cp -R "$SKILL_ROOT/capabilities" "$DEMO_DIR/capabilities"

# 5. 拷贝后端代码
cp -R "$SKILL_ROOT/scenarios/meeting-interpreter/backend" "$DEMO_DIR/scenarios/meeting-interpreter/backend"

# 6. 拷贝前端源码（排除 dist / node_modules / legacy）
cp -R "$SKILL_ROOT/scenarios/meeting-interpreter/ui" "$DEMO_DIR/scenarios/meeting-interpreter/ui"
rm -rf "$DEMO_DIR/scenarios/meeting-interpreter/ui/dist" \
       "$DEMO_DIR/scenarios/meeting-interpreter/ui/node_modules" \
       "$DEMO_DIR/scenarios/meeting-interpreter/ui/legacy"

# 7. 在 Demo 目录内安装依赖并构建前端
echo "[deploy-demo] installing npm dependencies (in demo dir)..."
cd "$DEMO_DIR/scenarios/meeting-interpreter/ui"
npm install --silent 2>&1 | tail -3

echo "[deploy-demo] building frontend..."
npm run build 2>&1 | tail -5

# 8. 验证构建结果
if [ ! -f "$DEMO_DIR/scenarios/meeting-interpreter/ui/dist/index.html" ]; then
  echo "DEPLOY_FAIL: 前端构建失败，dist/index.html 未生成"
  exit 1
fi

# 9. 确保 .env 权限为 600
chmod 600 "$DEMO_DIR/capabilities/conversation-core/.env" 2>/dev/null || true

echo "DEPLOY_OK: $DEMO_DIR"
