# Setup

Use this exact run sequence.

## 1. Prep

```bash
cd <project-root>
pnpm install
cp .env.example .env
```

Edit `.env`:

- Baseline:

```env
HOURLY_CONNECTORS=hn,github_issues
DAILY_CONNECTORS=greenhouse,lever,yc_companies
VITE_API_URL=http://127.0.0.1:3000
LOG_DIR=./logs/executions
REDIS_URL=redis://127.0.0.1:6391
DATABASE_URL=postgresql://idea_ai:idea_ai_dev@127.0.0.1:5917/idea_ai
EXA_DAILY_BUDGET_USD=0
PERIGON_DAILY_BUDGET_USD=0
AI_PROVIDER=both
AI_PROVIDER_PRIMARY=claude
AI_PROVIDER_MODE=single
AI_PROVIDER_FALLBACK=false
AI_PROVIDER_RETRIES=1
AI_POST_SCRAPE_ENABLED=true
AI_POST_SCRAPE_MAX_SIGNALS=80
AI_POST_SCRAPE_TIMEOUT_MS=120000
AI_JUDGE_MAX_SIGNALS=0
AI_JUDGE_TIMEOUT_MS=120000
```

AI provider modes:
- `AI_PROVIDER=claude`: only Claude AI calls.
- `AI_PROVIDER=codex`: only Codex AI calls.
- `AI_PROVIDER=both`: keeps both providers available for AI judging, with primary chosen by `AI_PROVIDER_PRIMARY`.
- `AI_PROVIDER_MODE=single`: uses only primary provider for judge calls.
- `AI_PROVIDER_MODE=ensemble`: calls both providers per judged signal and merges scores.
- `AI_PROVIDER_PRIMARY` controls provider order when `AI_PROVIDER=both`.
- `AI_PROVIDER_FALLBACK=true`: allow trying the other provider when primary fails (disabled by default to avoid long blocking refreshes).
- `AI_PROVIDER_RETRIES=1`: retries each provider call once before marking failure.
- `AI_POST_SCRAPE_ENABLED=true`: AI rewrites scraped items into opportunity ideas before ranking.
- `AI_POST_SCRAPE_MAX_SIGNALS`: batch size per refresh for AI post-scrape analysis.
- `AI_POST_SCRAPE_TIMEOUT_MS`: timeout per AI post-scrape call.
- `AI_JUDGE_MAX_SIGNALS=0`: disables per-signal judge calls by default (post-scrape batch AI is primary path).

- Optional daily open connectors:

```env
GREENHOUSE_BOARD_TOKEN=your_board_token
LEVER_SITE=your_lever_site_slug
```

- Optional BYO paid connectors:

```env
EXA_API_KEY=...
PERIGON_API_KEY=...
EXA_DAILY_BUDGET_USD=5
PERIGON_DAILY_BUDGET_USD=5
```

## 2. Start Docker infra (Postgres + Redis)

```bash
docker compose -f docker-compose.infra.yml up -d
docker compose -f docker-compose.infra.yml ps
```

## 2.5 Apply DB migrations

```bash
pnpm db:migrate
```

This runs all migrations (0001_init through 0004_tsvector) idempotently.

## 3. Optional AI CLI logins

```bash
claude auth login
codex login
codex login status
```

## 4. Run verification

```bash
CI=1 pnpm test
pnpm lint
```

## 5. Start API

```bash
pnpm --filter @idea/api dev
```

## 5A. Start API in Docker with `claude -p` inside container

This uses your host `~/.claude` auth directory by copying it into the API container on startup.

```bash
pnpm api:docker:up
pnpm api:docker:logs
```

Quick checks from inside the container:

```bash
docker compose -f docker-compose.infra.yml -f docker-compose.app.yml exec api claude auth status
docker compose -f docker-compose.infra.yml -f docker-compose.app.yml exec api claude -p "Return exactly: ok"
```

## 6. Validate API in another terminal

```bash
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/v1/connectors | jq
curl -s "http://127.0.0.1:3000/v1/signals?page=1&page_size=5" | jq
curl -s "http://127.0.0.1:3000/v1/logs?limit=20" | jq
curl -s "http://127.0.0.1:3000/v1/logs?limit=20&scope=all" | jq
curl -s "http://127.0.0.1:3000/v1/ai-health" | jq
```

Expected:
- `health` => `{"status":"ok"}`
- `connectors` => `hn/github_issues` active; others disabled unless configured
- `signals.items` => non-zero (from live hourly ingestion)
- `logs` => JSON log entries with `level`, `run_id`, `component`, and `message`
- `logs` defaults to current process session; use `scope=all` for historical logs
- `ai-health` => per-provider attempts/success/failure/retries for the latest refresh run

## 7. Start Web UI

```bash
pnpm --filter @idea/web dev
```

Open `http://localhost:5173`.

UI banner behavior:
- `Idea Candidate Found` appears when high-confidence candidates are detected.
- `No Strong Idea Yet` appears while the engine is still accumulating evidence.

## 8. Run one-command ingestion + RAG preview

```bash
pnpm preview:pipeline
```

This prints:
- connector status
- top 10 ranked signals (memory-aware scoring)
- idea detection summary:
  - `IDEA CANDIDATES FOUND (N):` with a candidate table
  - `No high-confidence idea candidate in this run.`

## 9. BYO account testing

- Add `EXA_API_KEY` and/or `PERIGON_API_KEY` in `.env`.
- Restart API.
- Re-run:

```bash
pnpm preview:pipeline
curl -s http://127.0.0.1:3000/v1/connectors | jq
```

Expected: `exa_byo`/`perigon_byo` become `active` when key + budget > 0.

## 10. Daily open-source testing

- Set `GREENHOUSE_BOARD_TOKEN` and `LEVER_SITE`.
- Restart API.
- Re-run:

```bash
pnpm preview:pipeline
```

Expected: daily events > 0.

## 11. Stop services

- `Ctrl+C` in API and Web terminals.
- Optional: `docker compose -f docker-compose.infra.yml down`
- If API runs in Docker: `pnpm api:docker:down`

## 12. Debug failures from execution logs

```bash
ls -la logs/executions
tail -n 200 logs/executions/*.jsonl
```

Each refresh writes JSONL logs grouped by `run_id`, including connector failures and fallback behavior.

The web UI also shows a live `Runtime Logs` pane sourced from `/v1/logs`.

AI monitoring:
- `ai judge summary` log shows `attempts`, `successful`, `fallback`, and `providers_used`.
- If provider calls fail or parsing fails, logs include `ai judge call failed` or `ai response parse failed`.

## Notes

- RAG scoring is active and persists memory in Postgres when `DATABASE_URL` is set.
