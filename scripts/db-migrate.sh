#!/usr/bin/env bash
set -euo pipefail

# Source .env if it exists
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5917}"
DB_USER="${DB_USER:-idea_ai}"
DB_NAME="${DB_NAME:-idea_ai}"

export PGPASSWORD="${POSTGRES_PASSWORD:-idea_ai_dev}"

for migration in apps/api/db/migrations/*.sql; do
  echo "Running $migration..."
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$migration"
done

echo "All migrations complete."
