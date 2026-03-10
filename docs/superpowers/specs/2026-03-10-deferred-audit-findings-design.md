# Deferred Audit Findings Remediation — Design Spec

Addresses findings 10, 11, 13, 22, and 25 from the 2026-03-10 full codebase audit (`docs/research/2026-03-10-full-codebase-audit.md`).

## Finding 10: pgvector-based dedup (replaces O(n²) all-pairs)

**Problem:** `packages/pipeline/src/dedup.ts:findDuplicates` compares every signal pair with cosine similarity in JS. At 4500 signals this is ~10M comparisons; at 20K it's 200M. The function is used in `apps/api/tests/v2-integration.test.ts` and as a standalone pipeline utility but is NOT called from the scoring loop in `live_read_model.ts` (that file uses a simple ID-based `dedupeEvents` for exact-match dedup, and `findConvergentSignals` for embedding-based cross-source detection).

**Solution:** Replace the JS `findDuplicates` with a pgvector-based implementation that queries the DB per signal instead of doing all-pairs comparison. This is a refactoring of the standalone dedup utility, not a change to the scoring loop.

**Changes:**

- Add `findDuplicatesByEmbedding(signalId: string, distanceThreshold?: number)` to `PostgresSignalStore`. SQL reuses the existing `convergentSql` pattern but with configurable distance threshold:
  ```sql
  SELECT se.signal_id, sm.source, (se.embedding <=> $1::vector) AS distance
  FROM signal_embeddings se
  JOIN scored_signals sm ON sm.signal_id = se.signal_id
  WHERE sm.signal_id != $2
    AND sm.source != $3
    AND sm.observed_at >= NOW() - INTERVAL '48 hours'
    AND (se.embedding <=> $1::vector) < $4
  ORDER BY distance
  LIMIT 5
  ```
  This mirrors `findConvergentSignals` but exposes the distance threshold parameter (default 0.08 = 1 - 0.92 cosine similarity). The 48-hour recency filter is preserved for consistency.
- Refactor the JS `findDuplicates` to accept an optional `pgFindDuplicates` function. When provided, it delegates to pgvector per new signal instead of all-pairs. When not provided, falls back to the existing JS implementation (for tests and non-DB mode).
- Update `v2-integration.test.ts` to test both the JS fallback and the pgvector path (with mock pool).

## Finding 11: Parallel connector execution with concurrency limiter

**Problem:** `apps/api/src/jobs/ingest_open.ts` runs 20+ connectors in a sequential `for` loop. Total ingestion time = sum of all connector durations.

**Solution:** Run connectors concurrently with a configurable concurrency limit.

**Changes:**

- New env var: `CONNECTOR_CONCURRENCY` (default 5). Add to `apps/api/src/config/env.ts`.
- Implement a simple concurrency limiter function in `ingest_open.ts` (no external dependency):
  ```typescript
  const pLimit = (concurrency: number) => {
    let active = 0;
    const queue: (() => void)[] = [];
    const next = () => { if (queue.length > 0 && active < concurrency) { active++; queue.shift()!(); } };
    return <T>(fn: () => Promise<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const run = () => fn().then(resolve, reject).finally(() => { active--; next(); });
        queue.push(run);
        next();
      });
  };
  ```
- Update `OpenIngestionDeps` type to include the concurrency option:
  ```typescript
  type OpenIngestionDeps = {
    logger?: ExecutionLogger;
    enabledConnectors?: OpenConnectorName[];
    loaders?: Partial<Record<OpenConnectorName, OpenConnectorLoader>>;
    concurrency?: number;
  };
  ```
- Replace the `for` loop with `Promise.allSettled(connectors.map(limit(runConnector)))`.
- Each connector's error handling stays unchanged (individual try/catch with status reporting).

## Finding 13: AbortController for in-flight refresh on shutdown

**Problem:** `readModel.close()` closes the DB pool, but an in-flight `startRefresh()` may still be running, causing writes to a closed pool.

**Solution:** Add an `AbortController` that signals cancellation on `close()`.

**Changes:**

- Add `let shutdownController = new AbortController()` to the live read model's closure state in `apps/api/src/runtime/live_read_model.ts`.
- In `startRefresh()`, check `shutdownController.signal.aborted` before each major phase (before ingestion, before scoring loop iteration, before convergence boost).
- In `close()`, call `shutdownController.abort()` before closing stores/pools.
- Return early when aborted — no partial writes to a closing DB.

## Finding 22: DB-backed BYO spend tracker

**Problem:** `packages/connectors/src/byo_guard.ts` checks `budgetUsd > 0` but never decrements after API calls. No real budget enforcement.

**Solution:** Track spend per connector per month in a DB table.

**Changes:**

- New migration file `apps/api/db/migrations/0029_byo_spend.sql` (following existing convention):
  ```sql
  CREATE TABLE IF NOT EXISTS byo_spend (
    connector TEXT NOT NULL,
    period TEXT NOT NULL,
    spent_usd NUMERIC(10,4) DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (connector, period)
  );
  ```
- New store: `apps/api/src/runtime/byo_spend_store.ts`
  - `record(connector: string, amountUsd: number): Promise<void>` — upserts current month's spend.
  - `getSpent(connector: string): Promise<number>` — returns current month's cumulative spend.
  - Period format: `YYYY-MM` (monthly reset).
- Update `evaluateByoGuard` in `packages/connectors/src/byo_guard.ts`: add optional `spentUsd?: number` parameter. Guard rejects when `budgetUsd - (spentUsd ?? 0) <= 0`.
- The spend lookup and recording happens in `apps/api/src/jobs/ingest_byo.ts` (which is in `apps/api` and can import the spend store). Flow:
  1. Before calling each BYO connector, `ingest_byo.ts` calls `spendStore.getSpent(connector)` and passes the result as `spentUsd` to `evaluateByoGuard` (which the connector calls internally — or alternatively, `ingest_byo.ts` calls the guard before dispatching).
  2. After a successful BYO connector call, `ingest_byo.ts` calls `spendStore.record(connector, COST_PER_CALL_USD)`.
- Each BYO connector defines a `COST_PER_CALL_USD` constant (e.g., `0.01` for Exa search). This is approximate — precise billing comes from the provider.
- The `spendStore` is created in `main.ts` and passed through to `runByoConnectorIngestion` deps.

## Finding 25: Idempotent convergence boost

**Problem:** `boostViralityScore` in `apps/api/src/runtime/postgres_signal_store.ts` adds `+convergenceBoost` to virality on every refresh cycle. Signals that keep matching via `findConvergentSignals` accumulate virality to 100 over repeated refreshes.

**Solution:** Make the boost idempotent using `GREATEST` instead of additive `+`.

**Changes:**

- Change `boostViralityScore` SQL from:
  ```sql
  SET virality = LEAST(100, COALESCE(virality, 0) + $2)
  ```
  to:
  ```sql
  SET virality = GREATEST(COALESCE(virality, 0), LEAST(100, $2))
  ```
  where `$2` is now the target virality (not a delta).
- The call site in `live_read_model.ts:841-847` computes the target:
  - For the current signal: `targetVirality = (score.virality ?? 0) + convergenceBoost` — the organic virality is known from the just-computed score.
  - For matched signals: `targetVirality = convergenceBoost` — we pass just the boost amount as a floor. `GREATEST` ensures this only raises virality if it's currently below the boost, and never lowers it. This is safe because matched signals already have their own organic virality computed from prior scoring.
- Update `boostViralityScore` type signature and implementation to reflect the semantic change (target, not delta).
- Recompute blended score using the new virality value in the same UPDATE.
- Update mock in `apps/api/tests/live-read-model-resilience.test.ts` to match new signature.

## Testing

- Finding 10: Test pgvector dedup with mock pool returning distance results. Keep existing JS dedup tests for fallback coverage.
- Finding 11: Test concurrent execution with mock loaders that track call timing. Verify concurrency limit is respected (no more than N active at once).
- Finding 13: Test that `close()` prevents further work in an in-flight refresh.
- Finding 22: Test spend recording/retrieval with mock pool. Test budget rejection when spend exceeds budget.
- Finding 25: Test that calling `boostViralityScore` twice with the same target doesn't change the value.

## Delivery

Single PR: `fix/audit-deferred-findings` against `dev`. All 5 findings are independent and touch different files, so they can be implemented and committed separately within the same branch.
