#!/usr/bin/env bash
set -euo pipefail

pnpm install
pnpm test
pnpm --filter @idea/api dev &
API_PID=$!

cleanup() {
  kill "$API_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

pnpm --filter @idea/web dev
