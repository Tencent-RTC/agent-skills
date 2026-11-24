#!/usr/bin/env bash
# bootstrap.sh — One-command setup: install Python deps + clone templates + run selfcheck pre-run
#
# Usage:
#   ./bootstrap.sh           # Full setup
#   ./bootstrap.sh --verify  # Setup + verify (selfcheck pre-run)
#
# This script lives at .claude/skills/trtc-eval/bootstrap.sh. It cd's to its
# own directory so all relative paths (scripts/, tests/, templates/, .cache/)
# resolve under the skill. The repo-level eval-runs directory uses an
# absolute REPO_ROOT path so it always lands in <repo>/.claude/eval-runs/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Repo root = three levels up from .claude/skills/trtc-eval/
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

VERIFY=false
if [[ "${1:-}" == "--verify" ]]; then
    VERIFY=true
fi

echo "=== TRTC Eval Tool Bootstrap ==="
echo ""

# -------------------------------------------------------
# 1. Python dependencies
# -------------------------------------------------------
echo "[1/5] Checking Python..."
if ! command -v python3 &>/dev/null; then
    echo "ERROR: python3 not found. Install Python 3.10+."
    exit 1
fi

PY_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "  Python version: $PY_VERSION"

echo "[1/5] Installing Python dependencies..."
pip3 install -r scripts/requirements.txt -q 2>/dev/null || pip install -r scripts/requirements.txt -q

# -------------------------------------------------------
# 2. System tool checks
# -------------------------------------------------------
echo "[2/5] Checking system tools..."

MISSING=()

# ripgrep (required)
if ! command -v rg &>/dev/null; then
    MISSING+=("rg (ripgrep) — brew install ripgrep / apt install ripgrep")
fi

# Platform tools (warn but don't fail)
echo "  Checking iOS tools..."
if command -v xcodebuild &>/dev/null; then
    echo "    xcodebuild: $(xcodebuild -version 2>/dev/null | head -1)"
else
    echo "    xcodebuild: NOT FOUND (iOS build will fail)"
fi

echo "  Checking Android tools..."
if command -v adb &>/dev/null; then
    echo "    adb: $(adb version 2>/dev/null | head -1)"
else
    echo "    adb: NOT FOUND (Android build will fail)"
fi

echo "  Checking Web tools..."
if command -v node &>/dev/null; then
    echo "    node: $(node --version)"
else
    echo "    node: NOT FOUND (Web build will fail)"
fi

# Install eval-only Node deps (puppeteer for scripts/log-bridge.mjs). Kept
# separate from templates/web-demo so demo deps stay clean. Chromium download
# (~170MB) happens on first install; subsequent runs reuse ~/.cache/puppeteer.
if [[ -f scripts/package.json ]] && command -v npm &>/dev/null; then
    if [[ ! -d scripts/node_modules/puppeteer ]]; then
        echo "  Installing eval Node dependencies (puppeteer)..."
        (cd scripts && npm install --silent) || {
            echo "  WARNING: scripts/ npm install failed. Web eval will fail until fixed."
        }
    else
        echo "    scripts/node_modules/puppeteer: present"
    fi
fi

if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo ""
    echo "ERROR: Missing required tools:"
    for m in "${MISSING[@]}"; do
        echo "  - $m"
    done
    exit 1
fi

# -------------------------------------------------------
# 3. Clone template repos (sparse-checkout)
# -------------------------------------------------------
echo "[3/5] Setting up template demos..."

TEMPLATE_REPO="https://github.com/Hanpto/project_template.git"
CACHE_DIR=".cache/project_template"

clone_template() {
    local platform_path="$1"
    local target_dir="$2"

    if [[ -d "$target_dir" && -f "$target_dir/INJECTION.json" ]]; then
        echo "  $target_dir already exists, skipping clone."
        return 0
    fi

    if [[ ! -d "$CACHE_DIR" ]]; then
        echo "  Cloning $TEMPLATE_REPO (sparse)..."
        git clone --filter=blob:none --no-checkout "$TEMPLATE_REPO" "$CACHE_DIR" 2>/dev/null || {
            echo "  WARNING: Failed to clone $TEMPLATE_REPO (network issue?)"
            echo "  Templates will not be available. Dynamic evaluation will fail."
            return 1
        }
    fi

    cd "$CACHE_DIR"
    git sparse-checkout set "$platform_path" 2>/dev/null || true
    git checkout 2>/dev/null || true
    local PINNED_COMMIT
    PINNED_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
    cd "$SCRIPT_DIR"

    if [[ -d "$CACHE_DIR/$platform_path" ]]; then
        mkdir -p "$target_dir"
        cp -R "$CACHE_DIR/$platform_path/"* "$target_dir/" 2>/dev/null || true
        # Write pinned_commit to INJECTION.json if it exists
        if [[ -f "$target_dir/INJECTION.json" ]]; then
            # Use python to safely update JSON
            python3 -c "
import json
p = '$target_dir/INJECTION.json'
d = json.loads(open(p).read())
d.setdefault('upstream', {})['pinned_commit'] = '$PINNED_COMMIT'
open(p, 'w').write(json.dumps(d, indent=2))
" 2>/dev/null || true
        fi
        echo "  $target_dir ready (commit: ${PINNED_COMMIT:0:8})"
    else
        echo "  WARNING: $platform_path not found in template repo."
        return 1
    fi
}

clone_template "ios/MyApplication" "templates/ios-demo" || true
clone_template "android/MyApplication" "templates/android-demo" || true
clone_template "web/MyApplication" "templates/web-demo" || true

# -------------------------------------------------------
# 4. Create necessary directories
# -------------------------------------------------------
echo "[4/5] Creating directories..."
mkdir -p "$REPO_ROOT/.claude/eval-runs"
mkdir -p templates/ios-demo templates/android-demo templates/web-demo

# -------------------------------------------------------
# 5. Verify (optional)
# -------------------------------------------------------
if [[ "$VERIFY" == true ]]; then
    echo "[5/5] Running selfcheck pre-run..."
    python3 scripts/selfcheck.py --phase=pre-run && echo "  selfcheck: PASSED" || {
        echo "  selfcheck: FAILED (see above for details)"
        echo "  This is expected if test account env vars are not set."
    }
else
    echo "[5/5] Skipping verification (use --verify to run selfcheck)"
fi

echo ""
echo "=== bootstrap OK ==="
echo ""
echo "Next steps (run from this directory: $SCRIPT_DIR):"
echo "  1. Set env vars: TRTC_TEST_SDKAPPID, TRTC_TEST_USERID, TRTC_TEST_USERSIG"
echo "  2. Run: python scripts/selfcheck.py --phase=cases-lint"
echo "  3. Run a single case: python scripts/case_runner_orchestrator.py --case-id=TC-LIVE-IOS-001 --run-dir=$REPO_ROOT/.claude/eval-runs/eval-test"
