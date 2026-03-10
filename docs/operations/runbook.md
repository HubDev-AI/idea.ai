# Runbook

## Scheduling

- Hourly connectors: `HOURLY_CONNECTORS` (default `hn,github_issues,showhn`), run every `DEFAULT_REFRESH_MS` (1 hour).
- Daily connectors: `DAILY_CONNECTORS`, run every 24 hours.
- Connectors execute in parallel with configurable concurrency (`CONNECTOR_CONCURRENCY`, default 5).
- BYO connectors are skipped unless API credentials are set and monthly budget allows.

## Connector Configuration

- `GREENHOUSE_BOARD_TOKEN`: required if `greenhouse` is enabled.
- `LEVER_SITE`: required if `lever` is enabled.
- `EXA_API_KEY`: required for `exa_byo`.
- `PERIGON_API_KEY`: required for `perigon_byo`.
- `X_BEARER_TOKEN`: required for `twitter_byo`.

If required connector config is missing, ingestion logs an error and skips that connector while continuing others.

### BYO Budget Enforcement

BYO connectors track spend per connector per month in the `byo_spend` database table:

- `EXA_DAILY_BUDGET_USD`, `PERIGON_DAILY_BUDGET_USD`, `X_DAILY_BUDGET_USD`: monthly budget cap per connector.
- Set budget to `0` to hard-disable paid BYO connector execution.
- Spend is recorded after each successful connector call and checked before the next.

## Reliability Guardrails

- Connector timeout: 15s.
- Retry attempts: 2 with backoff.
- Per-connector failure isolation: one source failure does not abort the full refresh.
- Snapshot fallback: if a refresh fails after a previous success, API serves the last successful snapshot.
- Graceful shutdown: `AbortController` cancels in-flight refreshes on SIGTERM — checks before ingestion, after connectors, and in the scoring loop.
- Convergence boost: idempotent via `GREATEST` SQL — repeated boosts don't accumulate virality.

## Persistent Storage

- Set `DATABASE_URL` to enable PostgreSQL-backed storage.
- Required extension: `pgvector` (`CREATE EXTENSION IF NOT EXISTS vector;`).
- Docker infra file: `docker-compose.infra.yml`.
  - PostgreSQL (`pgvector`) host port: `5917` → container `5432`
  - Redis host port: `6391` → container `6379`
- Apply migrations: `bash scripts/db-migrate.sh` (runs all `apps/api/db/migrations/*.sql` in order).
- Current migrations: `0001_init.sql` through `0029_byo_spend.sql`.
- Runtime behavior:
  - Each scored signal is upserted into `scored_signals` + `signal_embeddings`.
  - Similarity retrieval uses pgvector cosine distance.
  - Trend windows are computed from persisted history on each scoring pass.
  - Duplicate detection delegates to pgvector when available (JS fallback for non-DB mode).
  - Cadence timestamps stored in `refresh_state` DB table.

## Execution Logs

- `LOG_DIR` controls where JSONL execution logs are persisted (default `./logs/executions`).
- Each refresh uses a run id and appends structured entries to `LOG_DIR/<run_id>.jsonl`.
- Key fields: `run_id`, `level`, `component`, `message`, `context`.
- `/v1/logs` defaults to current process session logs (`scope=session`).
- Use `/v1/logs?scope=all` for full historical logs.
- Optional: set `RUN_ID` to force a fixed id for a single debug session.

Restart behavior:
- API loads cadence timestamps from the `refresh_state` database table at startup, so daily connectors are not re-fetched unnecessarily after a restart.

## AI Provider Runtime

See `docs/operations/provider-policy.md` for full provider configuration.

Key env vars:

| Var | Default | Description |
|-----|---------|-------------|
| `AI_PROVIDER` | `claude` | Primary provider |
| `AI_PROVIDER_FALLBACK` | `true` | Enable fallback to other provider |
| `AI_PROVIDER_RETRIES` | `1` | Retries per provider per call |
| `AI_POST_SCRAPE_ENABLED` | `true` | Enable AI batch analysis after scraping |
| `AI_POST_SCRAPE_MAX_SIGNALS` | `80` | Max signals per AI batch |
| `AI_POST_SCRAPE_TIMEOUT_MS` | `180000` | Timeout per AI call |
| `AI_JUDGE_MAX_SIGNALS` | `0` | Per-signal AI judging (0 = disabled) |
| `DEBATE_ENABLED` | `true` | Adversarial debate on top theses |
| `CONNECTOR_CONCURRENCY` | `5` | Max parallel connector fetches |

Key log entries:
- `ai post-scrape analysis succeeded`
- `ai post-scrape call failed for provider`
- `signal skipped by ai post-scrape noise filter`

Health API: `GET /v1/ai-health` returns provider status, circuit breaker state, attempts, failures.

## Ollama Setup

Ollama provides local embedding generation via `nomic-embed-text`.

```bash
brew install ollama
ollama serve
ollama pull nomic-embed-text
```

Verify: `curl -s http://localhost:11434/api/embeddings -d '{"model":"nomic-embed-text","prompt":"hello"}' | jq '.embedding | length'` → `768`

| Var | Default | Description |
|-----|---------|-------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Embedding model |

## Research Agent

The research agent runs on a configurable interval (default 1 hour) and orchestrates: cluster analysis → thesis synthesis → deep dives → debate.

| Var | Default | Description |
|-----|---------|-------------|
| `AGENT_INTERVAL_MS` | `3600000` | Interval between agent runs |
| `AGENT_TIMEOUT_MS` | `180000` | Timeout per AI call in agent |
| `AGENT_MAX_CLUSTERS` | `50` | Max signal clusters sent to AI |

Profiles run in parallel via `Promise.allSettled` (consumer + B2B). Configure profiles in `apps/api/src/profiles/`.

## Thesis Lifecycle

| State | Description |
|-------|-------------|
| `candidate` | Newly synthesized, insufficient evidence |
| `watching` | Moderate confidence, actively tracking |
| `promoted` | High confidence, surfaced in feed |
| `stale` | No new signals within freshness window |
| `rejected` | Contradicted by evidence or user dismissal |

Confidence thresholds: candidate→watching at 0.4, watching→promoted at 0.7, stale after 14 days.

## Connectors (20 active)

- **Hourly**: hn, github_issues, showhn
- **Daily**: greenhouse, lever, reddit, yc_companies, producthunt, appstore_trending, indiehackers, lobsters, devto, mastodon, homebrew, google_trends, stackoverflow, g2_reviews, npm_trends, semantic_scholar
- **BYO** (need API keys): exa, perigon, twitter, crunchbase
