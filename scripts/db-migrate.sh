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

PSQL="psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME"

# Create migration tracking table if it doesn't exist
$PSQL -c "CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);" 2>/dev/null || true

for migration in apps/api/db/migrations/*.sql; do
  name=$(basename "$migration")

  # Skip if already applied
  applied=$($PSQL -tAc "SELECT 1 FROM _migrations WHERE name = '$name'" 2>/dev/null || echo "")
  if [ "$applied" = "1" ]; then
    echo "Skipping $name (already applied)"
    continue
  fi

  echo "Running $name..."
  $PSQL -f "$migration"

  # Record migration
  $PSQL -c "INSERT INTO _migrations (name) VALUES ('$name') ON CONFLICT DO NOTHING;"
  echo "  Applied $name"
done

echo "All migrations complete."
