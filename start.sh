#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required but not found in PATH."
  exit 1
fi

echo "Installing/updating dependencies..."
pnpm install

echo "Starting control-plane..."
pnpm --filter @autoagent/control-plane dev &
CONTROL_PLANE_PID=$!

sleep 2

echo "Starting desktop app..."
pnpm --filter @autoagent/web dev &
WEB_PID=$!

cleanup() {
  echo ""
  echo "Stopping services..."
  kill "$WEB_PID" "$CONTROL_PLANE_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "AutoAgent dev mode is running."
echo "Press Ctrl+C to stop."

wait
