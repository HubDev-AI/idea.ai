# 2026-03-10 Full Codebase Audit

Scope: all packages (`packages/pipeline`, `packages/connectors`, `packages/ai-runtime`), API internals (`apps/api/src/jobs`, `apps/api/src/runtime`, `apps/api/src/routes`), and verification of prior audit fixes.

## Prior Fix Verification

All 9 findings and 5 refactoring candidates from the 2026-03-09 audit (PR #70) hold. Residual low-severity gaps:

- REST CORS reflects any origin when `CORS_ORIGINS` unset; Socket.IO defaults to `localhost:5173` only.
- `feed.ts` uses `sanitizeText()` not `sanitizeUrl()` on `source_url` (mitigated by DB-level sanitization + frontend `safeHref`).
- API key comparison uses `!==` not `crypto.timingSafeEqual` (acceptable for local-only app).

## Findings

### P1

1. External signal text injected raw into AI prompts without structural delimiters.
   - Evidence: `packages/pipeline/src/scoring/ai_score.ts:56-59` uses `.replace('{text}', signal.text.slice(0, 1500))` with text from Reddit, HN, GitHub etc. `packages/pipeline/src/scoring/noise_gate.ts:48-51` concatenates signal IDs and text directly.
   - Impact: crafted content on any monitored source can manipulate AI scoring output — fabricated scores, misclassified noise, suppressed signals.
   - Recommended fix: wrap user-controlled content in explicit delimiters (`<signal_text>...</signal_text>`) and instruct the model to ignore instructions within them. Strip control characters from signal text before prompt insertion.

2. Unbounded stdout/stderr accumulation in shell command runner.
   - Evidence: `packages/ai-runtime/src/types.ts:51-57` appends to `stdout`/`stderr` strings with no size cap. Only the 20s timeout limits output.
   - Impact: a runaway AI provider response can cause OOM in the API process.
   - Recommended fix: add a `MAX_BUFFER` cap (e.g. 1MB) and kill the child process if exceeded.

3. SSRF via YC Companies connector — remote-controlled URL construction.
   - Evidence: `packages/connectors/src/yc_companies.ts:53` uses `config.app` (scraped from HTML via regex) in URL template without validation. `config.key` (Algolia API key) is sent as a header to the constructed URL.
   - Impact: if the YC page is compromised or MITM'd, requests (including the Algolia key) go to an attacker-controlled domain.
   - Recommended fix: validate that `config.app` matches `^[A-Z0-9]{10,}$/i` before use.

4. Error stack traces leaked to API consumers.
   - Evidence: `apps/api/src/runtime/agent_run_store.ts:65-78` stores `error.stack` in the DB. `list()` and `latest()` use `SELECT *`, served via `GET /v1/agent/runs` at `apps/api/src/routes/agent_status.ts:26`.
   - Impact: exposes internal file paths, dependency versions, and potentially connection strings.
   - Recommended fix: exclude `error_stack` from the SELECT in `list()`/`latest()`, or strip it in the route response serializer.

5. Raw AI response text in error messages returned to clients.
   - Evidence: `apps/api/src/jobs/deep_dive_generator.ts:128-129` throws with `Preview: ${fallbackResult.text.slice(0, 200)}`. This propagates through `POST /v1/theses/:key/deep-dive` at `apps/api/src/routes/theses.ts:250`.
   - Impact: raw AI output (potentially containing system prompt fragments) reaches the client.
   - Recommended fix: log the preview server-side, return a generic error to the client.

6. Unbounded execution log file reading causes memory pressure.
   - Evidence: `apps/api/src/runtime/execution_log_reader.ts:65-79` reads ALL `.jsonl` files in the log directory into memory. No rotation, no file count cap, no date filtering.
   - Impact: over time, `GET /v1/logs` loads hundreds of MB, causing latency spikes and memory pressure.
   - Recommended fix: filter by date (last N days), add a file count cap, read only the specific file when `runId` is provided.

### P2

7. No HTTP timeouts on any connector fetch request.
   - Evidence: `packages/connectors/src/common/http.ts:92-112` (`fetchJsonWithRetry`) and all direct `fetch()` calls across 20+ connectors have no `AbortSignal.timeout()`. Connectors run sequentially in `apps/api/src/jobs/ingest_open.ts:99-133`.
   - Impact: one unresponsive upstream API hangs the entire ingestion cycle indefinitely.
   - Recommended fix: add a default timeout to `fetchJsonWithRetry` (e.g. 15s) and per-connector overrides where needed.

8. No timeout on Ollama embedding requests.
   - Evidence: `packages/ai-runtime/src/ollama.ts:21` — embedding fetch has no timeout, unlike `ollama_prompt.ts` which uses `AbortSignal.timeout(timeoutMs)`.
   - Impact: embedding requests block the scoring pipeline indefinitely if Ollama is unresponsive.
   - Recommended fix: add `signal: AbortSignal.timeout(options.timeoutMs ?? 10_000)`.

9. Double retry amplification — 9 requests per failure instead of 3.
   - Evidence: `packages/connectors/src/hn.ts:26`, `github_issues.ts:36`, `greenhouse.ts:34`, `lever.ts:30`, `yc_companies.ts:125-126` wrap `withRetry(() => loadItems())`, but loaders internally call `fetchJsonWithRetry` which also retries 3 times.
   - Impact: 3 × 3 = 9 HTTP requests per connector failure. Combined with no timeouts, ingestion can stall for extended periods.
   - Recommended fix: remove the outer `withRetry` from connectors that already use `fetchJsonWithRetry`, or pass `retries: 0` to the inner call.

10. O(n²) deduplication algorithm.
    - Evidence: `packages/pipeline/src/dedup.ts:32-48` — all-pairs cosine similarity. At 4500 signals ≈ 10M comparisons × embedding dimension.
    - Impact: dedup becomes a bottleneck as signal count grows. At 20K signals → 200M comparisons.
    - Recommended fix: use approximate nearest neighbors (LSH) or only compare new signals against existing.

11. Sequential connector execution blocks pipeline.
    - Evidence: `apps/api/src/jobs/ingest_open.ts:99-133` runs 20+ connectors in a `for` loop. Total time = sum of all durations.
    - Impact: ingestion takes much longer than necessary; one slow connector delays all scoring.
    - Recommended fix: run connectors with `Promise.allSettled()` and a concurrency limiter (e.g. 5).

12. Hardcoded consumer weights in `boostViralityScore` SQL.
    - Evidence: `apps/api/src/runtime/postgres_signal_store.ts:576-585` — blend formula `0.25 * demand + 0.20 * timing + 0.20 * buildability + 0.35 * virality` is the consumer profile's weights, hardcoded in SQL.
    - Impact: virality boosts apply the wrong formula for B2B profile signals.
    - Recommended fix: pass active weight config into `boostViralityScore` or defer reblending to the scoring pipeline.

13. No timer/interval cleanup on shutdown.
    - Evidence: `apps/api/src/runtime/live_read_model.ts` — `close()` at line 1132 only closes the signal store. `setInterval` timers in `main.ts` are not cleared. In-flight refresh continues against a closed DB pool.
    - Impact: unclean shutdown, potential errors and connection leaks.
    - Recommended fix: return `stopRefreshTimer` from the model, register as Fastify `onClose` hook, add `AbortController` for in-flight refreshes.

14. N+1 evidence inserts without transaction.
    - Evidence: `apps/api/src/runtime/postgres_thesis_store.ts:188-202` — each evidence item triggers a separate INSERT in a loop.
    - Impact: multiple roundtrips, no atomicity guarantee. Partial evidence if one INSERT fails.
    - Recommended fix: batch into a single multi-row INSERT, wrap in a transaction.

15. Inconsistent vector sanitization in experience and entity stores.
    - Evidence: `apps/api/src/runtime/experience_store.ts:25-27` and `entity_store.ts:37` use raw `.join(',')` instead of `toVectorLiteral()` from `db_utils.ts`.
    - Impact: NaN/Infinity values in embeddings produce corrupt SQL or bad data.
    - Recommended fix: use `toVectorLiteral()` consistently across all stores.

16. Missing input validation on thesis query parameters.
    - Evidence: `apps/api/src/routes/theses.ts:29` casts `request.query` without Fastify JSON schema validation. `label` param not whitelisted against valid values.
    - Impact: arbitrary strings pass through to DB queries. Not injectable (parameterized), but returns confusing empty results.
    - Recommended fix: add Fastify schema with enum constraints for `status`, `profile`, `label`, and `sort`.

### P3

17. `clamp()` utility duplicated 6 times across pipeline scoring modules.
    - Evidence: independent implementations in `pain.ts:3`, `timing.ts:3`, `buildability.ts:1`, `ai_score.ts:10`, `bayesian.ts:38`, `features.ts:3`.
    - Recommended fix: extract to a shared utility module.

18. Reddit connector silently swallows all per-subreddit errors.
    - Evidence: `packages/connectors/src/reddit.ts:64` — empty `catch {}` block with no logging.
    - Impact: if all subreddits fail, connector returns empty array with no indication.
    - Recommended fix: count failures and log at warn level if all fail.

19. ProductHunt HTML entity decoding only handles 3 entities.
    - Evidence: `packages/connectors/src/producthunt.ts:27-29` — only `&lt;`, `&gt;`, `&amp;`. Misses `&quot;`, `&#39;`, numeric entities.
    - Recommended fix: use a proper HTML entity decoder or expand the entity map.

20. `buildTrendWindows` uses O(n²) array spread pattern.
    - Evidence: `packages/pipeline/src/memory/windows.ts:26` — `grouped.set(key, [...(grouped.get(key) ?? []), record])` creates a new array on every insert.
    - Recommended fix: use `push()` on existing array.

21. App Store connector crashes on malformed entry.
    - Evidence: `packages/connectors/src/appstore.ts:37` — `entry.id.attributes['im:id']` with no null-safe access. One bad entry loses the entire category.
    - Recommended fix: use `entry?.id?.attributes?.['im:id'] ?? 'unknown'`.

22. BYO budget guard never tracks actual spend.
    - Evidence: `packages/connectors/src/byo_guard.ts:27-71` — checks `budgetUsd > 0` but never decrements after API calls.
    - Impact: no real budget enforcement.
    - Recommended fix: implement a spend tracker (in-memory or DB-backed).

23. `duration_ms` truncated to seconds before multiplication.
    - Evidence: `apps/api/src/runtime/agent_run_store.ts:43` — `EXTRACT(EPOCH ...)::int * 1000` truncates to whole seconds first.
    - Recommended fix: `(EXTRACT(EPOCH ...) * 1000)::int`.

24. Thesis upsert doesn't update `posterior_confidence` on conflict.
    - Evidence: `apps/api/src/runtime/postgres_thesis_store.ts:156-186` — `ON CONFLICT` sets `confidence` but not `posterior_confidence`.
    - Impact: `posterior_confidence` drifts out of sync.
    - Recommended fix: add `posterior_confidence = EXCLUDED.confidence` to the conflict clause.

25. Convergence boost can repeatedly inflate virality across refresh cycles.
    - Evidence: `apps/api/src/runtime/live_read_model.ts:834-855` — signals get virality boosts on every convergence match with no tracking of prior boosts.
    - Impact: popular topics accumulate virality to 100 over repeated refreshes.
    - Recommended fix: track whether a signal has already received a convergence boost.

26. Feed route error message reflects user input.
    - Evidence: `apps/api/src/routes/feed.ts:121` — `Invalid window value: ${windowParam}`.
    - Recommended fix: omit user value from error message.

27. Thesis key generation uses unsanitized AI-generated titles.
    - Evidence: `apps/api/src/jobs/agent_runner.ts:586` — `proposal.title` only gets lowercase + whitespace-to-underscore + truncation. Characters like `/`, `%`, `:` survive into URL paths.
    - Recommended fix: apply `replace(/[^a-z0-9_]/g, '')` to the key.

## Verification Notes

- `pnpm --filter @idea/web run build` passes.
- `CI=1 pnpm test` passes (394 tests).
- Prior audit fixes (PR #70) verified: WS auth, URL sanitization, auth guard, refresh guard, deep-dive dedup, hydration race fix (PR #75) — all correct and edge-case resistant.
