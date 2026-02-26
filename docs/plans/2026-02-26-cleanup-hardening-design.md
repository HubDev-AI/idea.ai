# Cleanup & Hardening Design

**Date:** 2026-02-26
**Status:** Approved
**Scope:** Full cleanup pass — infra, security, code quality, test coverage

## Context

The project reached a functional end-to-end state: 5 connectors feeding 37 signals, AI scoring via Claude, thesis synthesis, and a live dashboard. Before continuing feature testing, a full cleanup pass addresses security gaps, documentation holes, and code quality issues identified by audit.

## Phase 1: Infrastructure & Configuration

### Gitignore

Add to `.gitignore`:
- `.history/`
- `.claude/`
- `logs/`
- `.pnpm-store/`
- `apps/api/logs/`

### Docker Documentation

Create `docs/operations/docker.md`:
- Start/stop commands for `docker-compose.infra.yml`
- Service inventory: postgres (5917), redis (6391), ollama (11434)
- Ollama model pull instructions
- Migration commands
- Volume reset procedure

### Credential Externalization

- `docker-compose.infra.yml`: Replace hardcoded `POSTGRES_PASSWORD: idea_ai_dev` with `${POSTGRES_PASSWORD:-idea_ai_dev}`
- `package.json`: Remove `PGPASSWORD=idea_ai_dev` from `db:migrate` script; use a wrapper that sources `.env`

### .env.example Sync

- Add `OLLAMA_BASE_URL=http://localhost:11434`
- Remove V2-only vars that aren't wired yet
- Ensure all actually-used vars are documented

### setup.md

- Fix migration list to include all 4 files (0001-0004)
- Replace hardcoded absolute path with generic placeholder

## Phase 2: Security Hardening

### CORS

Replace origin reflection in `server.ts` with a whitelist:
- Default: `http://localhost:5173`
- Configurable via `CORS_ORIGINS` env var (comma-separated)

### API Key Authentication

Add `X-Api-Key` header check as a Fastify `onRequest` hook:
- Key from `API_KEY` env var
- Skip auth for `/health` and OPTIONS preflight
- When `API_KEY` is unset, all requests pass (dev mode)

### Rate Limiting

Add `@fastify/rate-limit`:
- Global: 100 req/min
- POST `/v1/theses/synthesize`: 10 req/min
- Configurable via env

### Fastify Schema Validation

Add JSON Schema to:
- `/v1/theses/:key` — validate `key` param as non-empty string
- `/v1/signals` — validate `page` and `page_size` as positive integers
- `/v1/logs` — validate `limit`, `level`, `run_id`

## Phase 3: Code Quality

### ThesisStore to Postgres

Wire `0003_thesis.sql` schema into a `PostgresThesisStore`:
- Implement `list()`, `getByKey()`, `upsert()` against the thesis tables
- Replace `InMemoryThesisStore` in `main.ts` when `DATABASE_URL` is set
- Theses persist across API restarts

### Replace Custom Dotenv

Swap `apps/api/src/config/dotenv.ts` with the `dotenv` package.

### Shared Types via @idea/contracts

Move to `packages/contracts/src/api.ts`:
- `FeedRecord`
- `AiHealthRecord`, `AiProviderHealthRecord`
- `ConnectorRecord`
- `ExecutionLogRecord`
- `ThesisListItem`

Import from `@idea/contracts` in both `apps/api` and `apps/web`.

### Complete Agent Runner TODOs

Wire `agent_runner.ts`:
- `recentSignals` — query from postgres memory store `listAllSignals()`
- `trendSummary` — query from postgres memory store trend windows

### Add Linting

Set up Biome:
- Minimal config in `biome.json` at workspace root
- Replace stub `lint` scripts in all `package.json` files
- Run lint as part of CI test script

## Phase 4: Test Coverage

### API Route Integration Tests

New test file `apps/api/tests/routes.test.ts`:
- Spin up Fastify via `buildServer()`
- Test CORS headers (allowed vs rejected origins)
- Test auth (401 when API_KEY set, pass-through when unset)
- Test rate limit headers
- Test schema validation errors (bad params return 400)
- Test pagination edge cases

### Security-Focused Tests

- Unauthenticated requests get 401 when API_KEY is configured
- CORS rejects unknown origins
- Rate limits trigger 429

### Postgres Memory Store Test

Add `apps/api/tests/postgres_memory_store.test.ts`:
- Mock pg pool
- Test `save()`, `listAllSignals()`, `retriever.findSimilar()`, `retriever.getTrendWindows()`

## Success Criteria

- All existing 136 tests still pass
- New tests bring total above 150
- `pnpm lint` runs real linting across all packages
- API rejects unauthenticated requests when API_KEY is set
- Theses persist across API restarts (Postgres-backed)
- No secrets in docker-compose or package.json
- `.gitignore` covers all transient directories
- `setup.md` is accurate and complete
