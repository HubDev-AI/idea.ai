# Docker Infrastructure

## Services

| Service  | Image                    | Host Port | Purpose              |
|----------|--------------------------|-----------|----------------------|
| postgres | pgvector/pgvector:pg17   | 5917      | Signal memory + theses |
| redis    | redis:7-alpine           | 6391      | Job queue (future)   |
| ollama   | ollama/ollama:latest     | 11434     | Local embeddings     |

## Start / Stop

```bash
# Start all infra
docker compose -f docker-compose.infra.yml up -d

# Stop (keep data)
docker compose -f docker-compose.infra.yml down

# Stop and delete all data
docker compose -f docker-compose.infra.yml down -v
```

## Database Migrations

```bash
pnpm db:migrate
```

Runs all migrations in `apps/api/db/migrations/` (0001-0004) idempotently.

## Ollama Model Setup

After first start, pull the embedding model:

```bash
docker exec idea-ai-ollama ollama pull nomic-embed-text
```

Verify:

```bash
docker exec idea-ai-ollama ollama list
```

## Volume Reset

To wipe all data and start fresh:

```bash
docker compose -f docker-compose.infra.yml down -v
docker compose -f docker-compose.infra.yml up -d
pnpm db:migrate
docker exec idea-ai-ollama ollama pull nomic-embed-text
```

## Health Checks

All services have built-in health checks. Verify with:

```bash
docker compose -f docker-compose.infra.yml ps
```

All services should show `(healthy)`.
