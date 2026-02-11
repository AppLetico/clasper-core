#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# OpenClaw × Clasper Integration Demo
#
# Prerequisites:
#   - Clasper Core running (make dev)
#   - ADAPTER_JWT_SECRET set in .env
#   - OPS_LOCAL_API_KEY set in .env (for policy seeding)
#
# Usage:
#   cd /path/to/clasper-core
#   bash integrations/openclaw/demos/demo.sh
# ══════════════════════════════════════════════════════════════════

set -euo pipefail

CLASPER_PORT="${CLASPER_PORT:-8081}"
CLASPER_URL="http://localhost:${CLASPER_PORT}"

echo ""
echo "  ══════════════════════════════════════════════════════════════"
echo "  OpenClaw × Clasper Integration Demo"
echo "  ══════════════════════════════════════════════════════════════"
echo "  Clasper Core: ${CLASPER_URL}"
echo ""

# ── Step 1: Check Clasper Core is running ──────────────────────────
echo "  [1/4] Checking Clasper Core is running..."
if ! curl -sf "${CLASPER_URL}/health" > /dev/null 2>&1; then
  echo "  ERROR: Clasper Core is not running at ${CLASPER_URL}."
  echo "         Start it with: make dev"
  exit 1
fi
echo "        ✓ Clasper Core is up."

# ── Step 2: Seed default policies ──────────────────────────────────
echo ""
echo "  [2/4] Seeding OpenClaw default policies..."
make seed-openclaw-policies 2>&1 | sed 's/^/        /'

# ── Step 3: Register adapter and get token ─────────────────────────
echo ""
echo "  [3/4] Registering OpenClaw adapter..."
REGISTER_RESPONSE=$(curl -sf -X POST "${CLASPER_URL}/adapters/register" \
  -H "Content-Type: application/json" \
  -d '{
    "adapter_id": "openclaw-local",
    "display_name": "OpenClaw Local Gateway",
    "risk_class": "high",
    "capabilities": ["exec", "write_file", "delete_file", "http_request", "web_fetch", "read_file"],
    "version": "0.1.0",
    "enabled": true
  }' 2>&1) || true

echo "        Registration response: ${REGISTER_RESPONSE}"

# Extract token if available
ADAPTER_TOKEN=$(echo "${REGISTER_RESPONSE}" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 2>/dev/null || echo "")

if [ -z "${ADAPTER_TOKEN}" ]; then
  echo "        NOTE: No token returned. The malicious skill demo may fail."
  echo "        You can set ADAPTER_TOKEN manually if needed."
fi

# ── Step 4: Run malicious skill demo ──────────────────────────────
echo ""
echo "  [4/4] Running malicious skill demo..."
echo ""

CLASPER_URL="${CLASPER_URL}" \
ADAPTER_TOKEN="${ADAPTER_TOKEN}" \
CLASPER_ADAPTER_ID="openclaw-local" \
  npx tsx integrations/openclaw/demos/malicious-skill.ts

echo "  Demo complete."
echo "  Open the Ops Console at ${CLASPER_URL}/ to see traces, audit log, and approvals."
echo ""
