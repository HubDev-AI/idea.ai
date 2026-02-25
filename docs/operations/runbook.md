# Runbook

## Scheduling

- Hourly connectors: `HOURLY_CONNECTORS` (default `hn,github_issues`) on cron `0 * * * *`.
- Daily connectors: `DAILY_CONNECTORS` (default `greenhouse,lever,yc_companies,exa_byo,perigon_byo`) on cron `0 0 * * *`.
- BYO connectors are skipped unless API credentials are set.

## Connector Configuration

- `GREENHOUSE_BOARD_TOKEN`: required if `greenhouse` is enabled.
- `LEVER_SITE`: required if `lever` is enabled.
- `EXA_API_KEY`: required for `exa_byo`.
- `PERIGON_API_KEY`: required for `perigon_byo`.

If required connector config is missing, ingestion logs an error and skips that connector while continuing others.

## Reliability Guardrails

- Connector timeout: 15s.
- Retry attempts: 2 with backoff.
- Raw payload retention: 30 days.
- Per-connector failure isolation: one source failure does not abort the full refresh.
- Snapshot fallback: if a refresh fails after a previous success, API serves the last successful snapshot.

## Persistent RAG Memory

- Set `DATABASE_URL` to enable PostgreSQL-backed memory across executions.
- Required extension: `pgvector` (`CREATE EXTENSION IF NOT EXISTS vector;`).
- Docker infra file: `docker-compose.infra.yml`.
  - PostgreSQL (`pgvector`) host port: `5917` -> container `5432`
  - Redis host port: `6391` -> container `6379`
- Apply migrations:
  - `apps/api/db/migrations/0001_init.sql`
  - `apps/api/db/migrations/0002_memory.sql`
- Runtime behavior:
  - each scored signal is upserted into `signal_memory` + `signal_embeddings`
  - similarity retrieval uses vector cosine distance from persisted embeddings
  - trend windows are computed from persisted history on each scoring pass

## Execution Logs

- `LOG_DIR` controls where JSONL execution logs are persisted (default `./logs/executions`).
- `SNAPSHOT_FILE` controls persisted last-successful feed snapshot (default `./logs/state/latest_snapshot.json`).
- Each refresh uses a run id and appends structured entries to `LOG_DIR/<run_id>.jsonl`.
- Key fields: `run_id`, `level`, `component`, `message`, `context`.
- `/v1/logs` defaults to current process session logs (`scope=session`) so stale/test history does not pollute the live UI.
- Use `/v1/logs?scope=all` for full historical logs across past sessions.
- Optional: set `RUN_ID` to force a fixed id for a single debug session.
- Example:

```bash
tail -f logs/executions/*.jsonl
curl -s "http://127.0.0.1:3000/v1/logs?limit=100" | jq
```

Restart behavior:
- API loads `SNAPSHOT_FILE` at startup before refresh, so last known signals/connectors remain available if upstream ingestion fails during restart.

## AI Judge Runtime

- `AI_PROVIDER`: `claude`, `codex`, or `both`.
- `AI_PROVIDER_PRIMARY`: optional (`claude` or `codex`) to set provider order when `AI_PROVIDER=both`.
- `AI_PROVIDER_MODE`: `single` (default) or `ensemble` (calls both providers per judged signal).
- `AI_PROVIDER_FALLBACK`: set `true` to attempt the other provider if primary fails.
- `AI_PROVIDER_RETRIES`: retry attempts per provider call after the initial attempt.
- `AI_POST_SCRAPE_ENABLED`: enable AI batch analysis immediately after scraping.
- `AI_POST_SCRAPE_MAX_SIGNALS`: max scraped signals per refresh in one AI batch call.
- `AI_POST_SCRAPE_TIMEOUT_MS`: timeout per AI post-scrape batch call.
- Recommended defaults: `AI_POST_SCRAPE_MAX_SIGNALS=6`, `AI_POST_SCRAPE_TIMEOUT_MS=120000`.
- `AI_JUDGE_MAX_SIGNALS`: max signals per refresh that attempt per-signal CLI AI judging (recommended default `0`).
- `AI_JUDGE_TIMEOUT_MS`: timeout per AI judge call (recommended default `120000`).
- Key log entries:
  - `ai post-scrape analysis succeeded`
  - `ai post-scrape analysis parse failed`
  - `signal skipped by ai post-scrape noise filter`
  - `ai judge summary`
  - `ai judge call failed for provider`
  - `ai response parse failed for provider`
  - `ai judge calls unavailable in ensemble mode, using fallback judge scores`
- Health API:
  - `GET /v1/ai-health` returns latest execution health for Claude/Codex (status, attempts, failures, retries, last error).

## Cost Guardrails

- Enforce `EXA_DAILY_BUDGET_USD` and `PERIGON_DAILY_BUDGET_USD`.
- Set budget to `0` to hard-disable paid BYO connector execution.

## Disable Switches

- Remove connector names from `HOURLY_CONNECTORS` / `DAILY_CONNECTORS`.
- Unset `EXA_API_KEY` / `PERIGON_API_KEY` to disable BYO connectors.
