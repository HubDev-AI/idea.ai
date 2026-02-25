#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

API_PID=""
WEB_PID=""
STARTED_API=0
STARTED_WEB=0

port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_http() {
  local url="$1"
  local retries="${2:-40}"
  local delay="${3:-0.5}"
  local i

  for ((i = 1; i <= retries; i += 1)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done

  return 1
}

wait_for_any_http() {
  local retries="${1:-40}"
  local delay="${2:-0.5}"
  shift 2
  local url

  for url in "$@"; do
    if wait_for_http "$url" "$retries" "$delay"; then
      printf '%s\n' "$url"
      return 0
    fi
  done

  return 1
}

cleanup() {
  if [[ "$STARTED_WEB" -eq 1 && -n "$WEB_PID" ]]; then
    kill "$WEB_PID" >/dev/null 2>&1 || true
  fi
  if [[ "$STARTED_API" -eq 1 && -n "$API_PID" ]]; then
    kill "$API_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

pnpm install
CI=1 pnpm test

if port_listening 3000; then
  echo "API already running on :3000, reusing it."
else
  pnpm --filter @idea/api dev &
  API_PID="$!"
  STARTED_API=1
fi

if port_listening 5173; then
  echo "Web already running on :5173, reusing it."
else
  pnpm --filter @idea/web dev -- --host 127.0.0.1 --port 5173 --strictPort &
  WEB_PID="$!"
  STARTED_WEB=1
fi

wait_for_http "http://127.0.0.1:3000/health"
WEB_BASE_URL="$(wait_for_any_http 40 0.5 "http://localhost:5173" "http://127.0.0.1:5173")"

echo "API health:"
curl -fsS http://127.0.0.1:3000/health
echo
echo "Connector status:"
curl -fsS http://127.0.0.1:3000/v1/connectors
echo
echo "Signals count:"
curl -fsS http://127.0.0.1:3000/v1/signals | jq 'length'
echo "Web title:"
curl -fsS "$WEB_BASE_URL" | rg -o '<title>[^<]+</title>' || true
echo
echo "Smoke check passed."
