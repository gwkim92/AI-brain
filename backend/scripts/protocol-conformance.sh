#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "[conformance] Running MCP/A2A smoke tests"
pnpm vitest \
  src/protocol/__tests__/mcp-transport.test.ts \
  src/protocol/__tests__/a2a-client.test.ts

echo "[conformance] Attempting A2A TCK"
if command -v a2a-tck >/dev/null 2>&1; then
  a2a-tck run
else
  echo "[conformance] a2a-tck not found, skipping TCK step"
fi
