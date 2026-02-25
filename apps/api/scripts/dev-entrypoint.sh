#!/usr/bin/env bash
set -euo pipefail

CLAUDE_SOURCE_DIR="${CLAUDE_CONFIG_SOURCE:-/host-claude}"
CLAUDE_TARGET_DIR="${CLAUDE_CONFIG_DIR:-/root/.claude}"

if [ -d "${CLAUDE_SOURCE_DIR}" ]; then
  mkdir -p "${CLAUDE_TARGET_DIR}"
  cp -R "${CLAUDE_SOURCE_DIR}/." "${CLAUDE_TARGET_DIR}/"
  chmod -R go-rwx "${CLAUDE_TARGET_DIR}" || true
fi

if command -v claude >/dev/null 2>&1; then
  if IS_SANDBOX="${IS_SANDBOX:-1}" claude auth status 2>/tmp/claude-auth.err | grep -q '"loggedIn": true'; then
    echo "Claude auth: ready"
  else
    echo "Claude auth: not ready in container; set CLAUDE_CODE_OAUTH_TOKEN in .env or run claude auth login inside container" >&2
  fi
fi

pnpm install --frozen-lockfile || pnpm install

exec pnpm --filter @idea/api dev
