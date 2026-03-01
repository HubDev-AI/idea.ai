# V1 Stabilization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all critical and medium bugs, remove dead code, and fill test coverage gaps identified in the v1 audit.

**Architecture:** Four sequential PRs — critical bugs first (correctness), then medium bugs (reliability/performance), then dead code cleanup, then test coverage. Each PR is self-contained and independently reviewable.

**Tech Stack:** Fastify, React 18, PostgreSQL + pgvector, pnpm monorepo, Vitest, Biome, TypeScript (exactOptionalPropertyTypes: true)

**Project root:** `/Users/vladimirtrifonov/src/ai/idea.ai`

---

## PR 1: Critical Bug Fixes

---

### Task 1: Add `canonical_text` to `SimilarSignalMatch` and `findSimilar` SQL

The deep dive LLM prompt receives `signal_id` strings instead of human-readable text because `SimilarSignalMatch` has no `canonical_text` field and the `findSimilar` SQL doesn't SELECT it.

**Files:**
- Modify: `packages/contracts/src/memory.ts:32-41`
- Modify: `apps/api/src/runtime/postgres_memory_store.ts:186-200,298-306`
- Modify: `apps/api/src/jobs/agent_runner.ts:275-282`

**Step 1: Update `similarSignalMatchSchema` in contracts**

In `packages/contracts/src/memory.ts`, add `canonical_text` to the schema at line 32-41:

```typescript
export const similarSignalMatchSchema = z
  .object({
    signal_id: z.string().min(1),
    distance: z.number().min(0),
    pain: scoreSchema,
    timing: scoreSchema,
    source: z.string().min(1),
    observed_at: z.string().datetime(),
    canonical_text: z.string().min(1)
  })
  .strict();
```

**Step 2: Update `similarSql` in postgres_memory_store**

In `apps/api/src/runtime/postgres_memory_store.ts`, update the SQL at lines 186-200. Add `signal_memory.canonical_text` to the SELECT:

```sql
SELECT
  signal_memory.signal_id,
  LEAST(GREATEST((signal_embeddings.embedding <=> $1::vector)::double precision, 0), 1) AS distance,
  signal_memory.pain,
  signal_memory.timing,
  signal_memory.source,
  signal_memory.observed_at,
  signal_memory.canonical_text
FROM signal_embeddings
JOIN signal_memory
  ON signal_memory.signal_id = signal_embeddings.signal_id
WHERE signal_memory.topic = $2 OR signal_memory.source = $3
ORDER BY signal_embeddings.embedding <=> $1::vector
LIMIT $4
```

**Step 3: Add `canonical_text` to the result mapping**

In the same file, update the `findSimilar` result mapping at lines 298-306. Add `canonical_text: row.canonical_text` to the returned object:

```typescript
return result.rows.map((row) => ({
  signal_id: row.signal_id,
  distance: Math.round(toNumber(row.distance) * 10000) / 10000,
  pain: toNumber(row.pain),
  timing: toNumber(row.timing),
  source: row.source,
  observed_at: toIsoString(row.observed_at),
  canonical_text: row.canonical_text
}));
```

Also add `canonical_text: string` to the `SimilarRow` type used internally.

**Step 4: Fix `agent_runner.ts` to use `canonical_text`**

In `apps/api/src/jobs/agent_runner.ts`, at line 277, change `text: s.signal_id` to `text: s.canonical_text`:

```typescript
historicalSignals = similar.map((s) => ({
  signal_id: s.signal_id,
  text: s.canonical_text,
  source: s.source,
  pain: s.pain,
  timing: s.timing
}));
```

**Step 5: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All tests pass. The agent-runner tests use mocked `memoryStore` so the schema change is transparent.

**Step 6: Commit**

```bash
git add packages/contracts/src/memory.ts apps/api/src/runtime/postgres_memory_store.ts apps/api/src/jobs/agent_runner.ts
git commit -m "fix: return canonical_text from findSimilar so deep dive prompt gets real signal text"
```

---

### Task 2: Fix AI judge `defaultMaxSignals` bug

Both branches of `isTest ? 0 : 0` return 0, silently disabling AI judging in production unless `AI_JUDGE_MAX_SIGNALS` env var is set.

**Files:**
- Modify: `apps/api/src/jobs/ai_judges.ts:138`
- Test: `apps/api/tests/ai-judges.test.ts`

**Step 1: Write the failing test**

In `apps/api/tests/ai-judges.test.ts`, add a test verifying the production default is nonzero. Find the test file's import of `resolveAiJudgeSettings` and add:

```typescript
it('production default maxSignals is 50 when AI_JUDGE_MAX_SIGNALS is unset', () => {
  const settings = resolveAiJudgeSettings({ NODE_ENV: 'production' });
  expect(settings.maxSignals).toBe(50);
});

it('test default maxSignals is 0 when NODE_ENV=test', () => {
  const settings = resolveAiJudgeSettings({ NODE_ENV: 'test', VITEST: 'true' });
  expect(settings.maxSignals).toBe(0);
});
```

**Step 2: Run tests to verify failure**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run apps/api/tests/ai-judges.test.ts`
Expected: FAIL — `expected 50 but received 0`

**Step 3: Fix the bug**

In `apps/api/src/jobs/ai_judges.ts`, line 138, change:

```typescript
const defaultMaxSignals = isTest ? 0 : 0;
```

to:

```typescript
const defaultMaxSignals = isTest ? 0 : 50;
```

**Step 4: Run tests to verify pass**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run apps/api/tests/ai-judges.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/jobs/ai_judges.ts apps/api/tests/ai-judges.test.ts
git commit -m "fix: set production default AI_JUDGE_MAX_SIGNALS to 50 (was 0 in both branches)"
```

---

### Task 3: Await in-flight agent run during shutdown

If SIGTERM arrives during an agent run, the DB row stays `status='running'` forever and theses are partially updated.

**Files:**
- Modify: `apps/api/src/main.ts:69-72,159-181`

**Step 1: Store the agent promise and expose cancelation**

In `apps/api/src/main.ts`, the `agentRunInFlight` variable already holds the promise. Update the `shutdown` function (lines 159-181) to await it with a timeout and mark as failed:

```typescript
const SHUTDOWN_TIMEOUT_MS = 15_000;

const shutdown = async () => {
  clearInterval(agentTimer);

  // Wait for in-flight agent run, mark as failed if still running
  if (agentRunInFlight) {
    try {
      await Promise.race([
        agentRunInFlight,
        new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown timeout')), SHUTDOWN_TIMEOUT_MS))
      ]);
    } catch {
      // Run was interrupted or timed out — agentRunStore.fail() already called in executeAgentRun's catch block
    }
    agentRunInFlight = null;
  }

  await readModel.close();
  if (memoryStore) {
    await memoryStore.close();
  }
  if ('close' in thesisStore) {
    await (thesisStore as { close: () => Promise<void> }).close();
  }
  if (pool) {
    await pool.end();
  }
  await app.close();
  process.exit(0);
};
```

**Step 2: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All tests pass (shutdown path is not exercised in tests but should not break existing tests).

**Step 3: Commit**

```bash
git add apps/api/src/main.ts
git commit -m "fix: await in-flight agent run on shutdown to prevent stuck 'running' DB rows"
```

---

### Task 4: Compute `avgPain`, `avgTiming`, `avgBuildability` from evidence

These fields are hardcoded to 0 in `rowToDraft`. The thesis_candidates table doesn't store them, so we must compute from joined `signal_memory` data.

**Files:**
- Modify: `apps/api/src/runtime/postgres_thesis_store.ts:33-51,62-87`
- Test: `apps/api/tests/postgres_thesis_store.test.ts`

**Step 1: Update the SQL queries to compute averages**

In `apps/api/src/runtime/postgres_thesis_store.ts`, the `list` query (lines 62-73) currently joins `thesis_evidence` and `signal_memory` for counts only. Add aggregate columns:

Update the SQL to add:
```sql
ROUND(COALESCE(AVG(sm.pain), 0))::int AS avg_pain,
ROUND(COALESCE(AVG(sm.timing), 0))::int AS avg_timing,
ROUND(COALESCE(AVG(sm.buildability), 0))::int AS avg_buildability
```

Do the same for the `getByKey` query at lines 78-87 and the `listPaginated` query.

**Step 2: Update `rowToDraft` to use computed values**

In `rowToDraft` (lines 33-51), replace the hardcoded zeros:

```typescript
avgPain: toNumber(row.avg_pain),
avgTiming: toNumber(row.avg_timing),
avgBuildability: toNumber(row.avg_buildability),
```

Add `avg_pain`, `avg_timing`, `avg_buildability` to the `ThesisRow` type.

**Step 3: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run apps/api/tests/postgres_thesis_store.test.ts`
Expected: PASS (tests use mocked stores or will need updated expected values)

**Step 4: Run full test suite**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass

**Step 5: Commit**

```bash
git add apps/api/src/runtime/postgres_thesis_store.ts
git commit -m "fix: compute avgPain/avgTiming/avgBuildability from signal_memory instead of hardcoding 0"
```

---

### Task 5: Add `reddit` and `producthunt` to OPEN_CONNECTORS

These connectors are fully implemented and configured in env but excluded from the hardcoded `OPEN_CONNECTORS` array.

**Files:**
- Modify: `apps/api/src/runtime/live_read_model.ts:46`

**Step 1: Add the connectors**

In `apps/api/src/runtime/live_read_model.ts`, line 46, change:

```typescript
const OPEN_CONNECTORS: OpenConnectorName[] = ['hn', 'github_issues', 'greenhouse', 'lever', 'yc_companies'];
```

to:

```typescript
const OPEN_CONNECTORS: OpenConnectorName[] = ['hn', 'github_issues', 'greenhouse', 'lever', 'yc_companies', 'reddit', 'producthunt'];
```

**Step 2: Update the cadence filter if needed**

Check `enabledOpenConnectors` (lines 257-268). `reddit` and `producthunt` are daily connectors (like greenhouse/lever/yc_companies). The cadence filter at line 258-263 already excludes non-hn/github connectors from hourly and includes them in daily. So `reddit` and `producthunt` will automatically run on the `daily` cadence. Verify this is correct — no code change needed.

**Step 3: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass

**Step 4: Commit**

```bash
git add apps/api/src/runtime/live_read_model.ts
git commit -m "fix: add reddit and producthunt to OPEN_CONNECTORS (were configured but never ingested)"
```

---

### Task 6: Add React error boundary

A render crash (e.g., null access on API response) causes a blank white screen with no recovery.

**Files:**
- Create: `apps/web/src/components/ErrorBoundary.tsx`
- Modify: `apps/web/src/main.tsx`

**Step 1: Create the error boundary component**

Create `apps/web/src/components/ErrorBoundary.tsx`:

```tsx
import React from 'react';

type ErrorBoundaryState = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace', color: '#ccc', background: '#1a1a1a', minHeight: '100vh' }}>
          <h1 style={{ color: '#ff6b6b' }}>Something went wrong</h1>
          <p style={{ color: '#999' }}>The app encountered an unexpected error.</p>
          <pre style={{ color: '#ff6b6b', fontSize: '0.85rem', marginTop: '1rem', whiteSpace: 'pre-wrap' }}>
            {this.state.error?.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              background: '#333',
              color: '#ccc',
              border: '1px solid #555',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

**Step 2: Wrap `<App />` in the error boundary**

In `apps/web/src/main.tsx`, change:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
```

**Step 3: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass

**Step 4: Commit**

```bash
git add apps/web/src/components/ErrorBoundary.tsx apps/web/src/main.tsx
git commit -m "fix: add React error boundary to prevent blank screen on render crash"
```

---

### Task 7: Deprecate `routeNextQueue` (singular)

`routeNextQueue` only returns the first queue from a fan-out, silently dropping `scoreTiming` and `scoreBuildability` after `memory:index`. Since this function is never called in production, deprecate it.

**Files:**
- Modify: `packages/pipeline/src/worker.ts:39-42`

**Step 1: Add deprecation and fix**

In `packages/pipeline/src/worker.ts`, replace lines 39-42:

```typescript
/**
 * @deprecated Use `routeNextQueues` (plural) to avoid dropping fan-out routes.
 * This function only returns the first queue and silently drops the rest.
 */
export const routeNextQueue = (jobName: string): QueueName | null => {
  const next = routeNextQueues(jobName);
  if (next.length > 1) {
    console.warn(`routeNextQueue: dropping ${next.length - 1} fan-out queues for "${jobName}". Use routeNextQueues instead.`);
  }
  return next[0] ?? null;
};
```

**Step 2: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass (pipeline-wiring tests may use this function)

**Step 3: Commit**

```bash
git add packages/pipeline/src/worker.ts
git commit -m "fix: deprecate routeNextQueue and warn when fan-out routes are dropped"
```

---

### Task 8: Unify agent runId

`main.ts` generates one `runId`, `agent_runner.ts` generates another. Journal entries use the agent_runner's ID while `agent_runs` table uses main.ts's ID, making them uncorrelatable.

**Files:**
- Modify: `apps/api/src/jobs/agent_runner.ts:40-69`
- Modify: `apps/api/src/main.ts:69-72`

**Step 1: Accept `runId` as a dependency in `AgentRunnerDeps`**

In `apps/api/src/jobs/agent_runner.ts`, find the `AgentRunnerDeps` type and add an optional `runId` field:

```typescript
runId?: string;
```

Then at line 69 where `const runId = \`agent-${Date.now()}\`` is defined, change to:

```typescript
const runId = deps.runId ?? `agent-${Date.now()}`;
```

**Step 2: Pass `runId` from `main.ts`**

In `apps/api/src/main.ts`, inside `executeAgentRun` (around line 72), the `runId` is already generated:

```typescript
const runId = `agent-${Date.now()}`;
```

Pass it to `runResearchAgent`:

```typescript
const result = await runResearchAgent({
  ...existingDeps,
  runId,
});
```

**Step 3: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass

**Step 4: Commit**

```bash
git add apps/api/src/jobs/agent_runner.ts apps/api/src/main.ts
git commit -m "fix: pass unified runId from main.ts to agent_runner so journal entries correlate with agent_runs rows"
```

---

### Task 9: Push PR 1

**Step 1: Create feature branch and push**

```bash
cd /Users/vladimirtrifonov/src/ai/idea.ai
git checkout -b feature/v1-critical-fixes
git push -u origin feature/v1-critical-fixes
```

**Step 2: Create PR**

```bash
gh pr create --title "fix: critical bug fixes from v1 audit" --body "$(cat <<'EOF'
## Summary
- Return canonical_text from findSimilar so deep dive AI reads real signal text, not IDs
- Fix AI judge defaultMaxSignals (was `0` in both test and production branches)
- Await in-flight agent run on shutdown to prevent stuck 'running' DB rows
- Compute avgPain/avgTiming/avgBuildability from signal_memory instead of hardcoding 0
- Add reddit and producthunt to OPEN_CONNECTORS
- Add React error boundary to prevent blank screen on render crash
- Deprecate routeNextQueue (singular) and warn on fan-out drops
- Unify agent runId between main.ts and agent_runner.ts

## Test plan
- [x] All existing tests pass
- [x] New test: production AI judge maxSignals defaults to 50
- [ ] Manual: trigger agent run, verify logs show signal text (not IDs)
- [ ] Manual: verify reddit/producthunt appear in connector status after daily run

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" --base dev
```

**Step 3: Merge PR**

```bash
gh pr merge --squash --delete-branch
git checkout dev && git pull
```

---

## PR 2: Medium Bug Fixes

---

### Task 10: Fix embedding mismatch in `findSimilar`

`findSimilar` uses `buildLocalEmbedding` (hash-based) for queries while the stored vectors are from Ollama. The vector spaces don't match, degrading search quality.

**Files:**
- Modify: `apps/api/src/runtime/postgres_memory_store.ts:288-307`

**Step 1: Accept an optional `embedText` function in the memory store factory**

In `apps/api/src/runtime/postgres_memory_store.ts`, update the factory's options type to accept an optional `embedText`:

```typescript
export const createPostgresMemoryStore = ({
  databaseUrl,
  embedText
}: {
  databaseUrl: string;
  embedText?: (text: string) => Promise<number[] | null>;
}): PostgresMemoryStore => {
```

**Step 2: Use `embedText` in `findSimilar` when available**

In the `findSimilar` method (around line 291), change:

```typescript
const queryEmbedding = buildLocalEmbedding(query.canonicalText);
```

to:

```typescript
const queryEmbedding = embedText
  ? (await embedText(query.canonicalText)) ?? buildLocalEmbedding(query.canonicalText)
  : buildLocalEmbedding(query.canonicalText);
```

This tries Ollama first, falls back to local hash if Ollama is unavailable.

**Step 3: Pass `embedText` from `main.ts`**

In `apps/api/src/main.ts`, when creating `memoryStore`, pass the same `embedText` function used by the agent:

```typescript
const memoryStore = databaseUrl
  ? createPostgresMemoryStore({ databaseUrl, embedText: embedTextFn })
  : null;
```

Where `embedTextFn` is the Ollama embedding function already available in main.ts's deps.

**Step 4: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass

**Step 5: Commit**

```bash
git add apps/api/src/runtime/postgres_memory_store.ts apps/api/src/main.ts
git commit -m "fix: use Ollama embeddings for similarity queries instead of local hash fallback"
```

---

### Task 11: Consolidate duplicate pg.Pool instances

`live_read_model` creates its own `PostgresMemoryStore` (max: 8 connections), `main.ts` creates another `memoryStore` (max: 8), plus `journalStore` creates another (max: 4). Total: up to 20 connections to the same DB.

**Files:**
- Modify: `apps/api/src/main.ts:26-45`

**Step 1: Pass shared memoryStore into live_read_model**

In `apps/api/src/main.ts`, restructure so `memoryStore` is created first, then passed to `createLiveReadModel`:

```typescript
const memoryStore = databaseUrl
  ? createPostgresMemoryStore({ databaseUrl, embedText: embedTextFn })
  : null;

const readModel = createLiveReadModel({ persistentStore: memoryStore ?? undefined });
```

This requires `createLiveReadModel` to accept an optional `persistentStore` parameter. Check if it already does — in `live_read_model.ts` it internally creates its own store. Update it to accept and prefer an external one.

**Step 2: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass

**Step 3: Commit**

```bash
git add apps/api/src/main.ts apps/api/src/runtime/live_read_model.ts
git commit -m "fix: share single PostgresMemoryStore pool between main.ts and live_read_model"
```

---

### Task 12: Add data retention cleanup job

Tables and log files grow unbounded. `defaultRawRetentionDays = 30` is defined in `config/limits.ts` but never used.

**Files:**
- Create: `apps/api/db/migrations/0010_retention_policy.sql`
- Modify: `apps/api/src/main.ts`

**Step 1: Create the migration**

Create `apps/api/db/migrations/0010_retention_policy.sql`:

```sql
-- Data retention: indexes to support efficient cleanup queries
CREATE INDEX IF NOT EXISTS signal_memory_observed_idx ON signal_memory (observed_at);
CREATE INDEX IF NOT EXISTS agent_journal_created_idx_exists ON agent_journal (created_at);
-- agent_runs already has started_at index from 0009
```

**Step 2: Add a cleanup function in main.ts**

In `apps/api/src/main.ts`, add a cleanup function that runs on a timer (e.g., every 6 hours):

```typescript
const RETENTION_DAYS = 90;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

const runRetentionCleanup = async () => {
  if (!pool) return;
  try {
    await pool.query(`DELETE FROM signal_memory WHERE observed_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`);
    await pool.query(`DELETE FROM signal_embeddings WHERE signal_id NOT IN (SELECT signal_id FROM signal_memory)`);
    await pool.query(`DELETE FROM agent_journal WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`);
    await pool.query(`DELETE FROM agent_runs WHERE started_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`);
  } catch (err) {
    console.error('retention cleanup failed:', err);
  }
};

// Schedule cleanup after server starts
let cleanupTimer: ReturnType<typeof setInterval>;
// In the .then() after listen:
cleanupTimer = setInterval(() => void runRetentionCleanup(), CLEANUP_INTERVAL_MS);
void runRetentionCleanup(); // Run once on startup
```

Add `clearInterval(cleanupTimer)` to the shutdown handler.

**Step 3: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass

**Step 4: Commit**

```bash
git add apps/api/db/migrations/0010_retention_policy.sql apps/api/src/main.ts
git commit -m "feat: add data retention cleanup job (90 days for signals, journal, runs)"
```

---

### Task 13: Close journal store pool in shutdown

The `journalStore` creates its own `pg.Pool` which is never closed.

**Files:**
- Modify: `apps/api/src/runtime/journal_store.ts`
- Modify: `apps/api/src/main.ts`

**Step 1: Expose a `close` method on `JournalStore`**

In `apps/api/src/runtime/journal_store.ts`, add `close` to the `JournalStore` interface (around line 22-29):

```typescript
export interface JournalStore {
  write(entries: JournalEntry[]): Promise<void>;
  recent(limit: number): Promise<JournalEntry[]>;
  byType(type: JournalEntryType, limit: number): Promise<JournalEntry[]>;
  byThesisKey(key: string, limit: number): Promise<JournalEntry[]>;
  findSimilar(embedding: number[], topK: number): Promise<JournalEntry[]>;
  count(): Promise<number>;
  close(): Promise<void>;
}
```

In the `createPostgresJournalStore` factory, add the close method to the returned object:

```typescript
close: async () => {
  await pool.end();
}
```

**Step 2: Call `journalStore.close()` in shutdown**

In `apps/api/src/main.ts`, in the `shutdown` function, add before `pool.end()`:

```typescript
if (journalStore && 'close' in journalStore) {
  await journalStore.close();
}
```

**Step 3: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass

**Step 4: Commit**

```bash
git add apps/api/src/runtime/journal_store.ts apps/api/src/main.ts
git commit -m "fix: close journal store pool in shutdown handler to prevent connection leak"
```

---

### Task 14: Separate thesis fetch from bulk polling

Changing the thesis page triggers a full 7-endpoint refresh when it should only refetch theses.

**Files:**
- Modify: `apps/web/src/App.tsx:130-234`

**Step 1: Split `requestedThesisPage` out of the main effect dependency array**

In `apps/web/src/App.tsx`, create a separate `useEffect` for thesis fetching that only depends on `requestedThesisPage` and `thesisFilter`:

```typescript
// Separate thesis-only fetch
useEffect(() => {
  let isCancelled = false;
  const loadTheses = async () => {
    try {
      const tp = await fetchTheses({
        page: requestedThesisPage,
        pageSize: 10,
        ...(thesisFilter ? { status: thesisFilter } : {})
      });
      if (isCancelled) return;
      if (Array.isArray(tp)) {
        setTheses(tp);
      } else {
        setTheses(tp.items);
        setThesisPageInfo({
          page: tp.page,
          pageSize: tp.page_size,
          totalItems: tp.total_items,
          totalPages: tp.total_pages,
          hasNext: tp.has_next,
          hasPrev: tp.has_prev
        });
      }
    } catch { /* handled by bulk fetch warning */ }
  };
  void loadTheses();
  return () => { isCancelled = true; };
}, [requestedThesisPage, thesisFilter]);
```

Then remove `requestedThesisPage` from the main polling effect's dependency array (line 234). The main effect still fetches theses on its 15-second poll, which is fine for background refresh.

**Step 2: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass

**Step 3: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "fix: separate thesis page fetch from bulk polling to avoid 7-endpoint refresh on page change"
```

---

### Task 15: Move `AgentRunResult` to contracts

The type is duplicated between API (`agent_runner.ts`) and web (`api.ts`).

**Files:**
- Modify: `packages/contracts/src/api.ts`
- Modify: `apps/api/src/jobs/agent_runner.ts`
- Modify: `apps/web/src/api.ts`

**Step 1: Add `AgentRunResult` to contracts**

In `packages/contracts/src/api.ts`, add after the `AgentStatusRecord` type:

```typescript
export type AgentRunResult = {
  thesesUpdated: number;
  newCandidates: number;
  alerts: string[];
  investigateNext: string;
  journalEntriesWritten: number;
  clustersAnalyzed: number;
  deepDivesPerformed: number;
};
```

**Step 2: Import from contracts in agent_runner.ts**

In `apps/api/src/jobs/agent_runner.ts`, replace the local `AgentRunResult` type definition with:

```typescript
import type { AgentRunResult } from '@idea/contracts/src/api';
```

Remove the local type definition.

**Step 3: Import from contracts in api.ts (web)**

In `apps/web/src/api.ts`, replace the local `AgentRunResult` type with:

```typescript
import type { AgentRunResult } from '@idea/contracts/src/api';
export type { AgentRunResult };
```

Remove the local type definition (lines 133-141).

**Step 4: Update agent_run_store.ts import**

In `apps/api/src/runtime/agent_run_store.ts`, line 2, update the import to point to contracts:

```typescript
import type { AgentRunResult } from '@idea/contracts/src/api';
```

**Step 5: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass

**Step 6: Commit**

```bash
git add packages/contracts/src/api.ts apps/api/src/jobs/agent_runner.ts apps/web/src/api.ts apps/api/src/runtime/agent_run_store.ts
git commit -m "refactor: move AgentRunResult type to contracts to eliminate duplication"
```

---

### Task 16: Add Codex fallback retry in dual_analyst

The retry only retries Claude, never Codex, even if Claude is the failing provider.

**Files:**
- Modify: `packages/ai-runtime/src/dual_analyst.ts:83-91`

**Step 1: Add Codex retry after Claude retry fails**

In `packages/ai-runtime/src/dual_analyst.ts`, replace the retry block (lines 83-91):

```typescript
if (claude === null && codex === null) {
  // Try Claude first
  await log?.info('dual_analyst', 'both failed, retrying claude');
  try {
    const retry = await deps.runClaude(input);
    try { claude = deps.parseResponse(retry.text); } catch { /* skip */ }
    await log?.info('dual_analyst', 'claude retry result', { parsed: claude !== null });
  } catch { /* exhausted */ }

  // If Claude retry also failed, try Codex
  if (claude === null) {
    await log?.info('dual_analyst', 'claude retry failed, trying codex');
    try {
      const retry = await deps.runCodex(input);
      try { codex = deps.parseResponse(retry.text); } catch { /* skip */ }
      await log?.info('dual_analyst', 'codex retry result', { parsed: codex !== null });
    } catch { /* both retries exhausted */ }
  }
}
```

**Step 2: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass

**Step 3: Commit**

```bash
git add packages/ai-runtime/src/dual_analyst.ts
git commit -m "fix: add Codex fallback retry when Claude retry also fails in dual_analyst"
```

---

### Task 17: Support `GITHUB_TOKEN` in GitHub connector

The connector makes unauthenticated API calls hitting a strict 10 req/min rate limit.

**Files:**
- Modify: `packages/connectors/src/github_issues.ts:14-27`

**Step 1: Add optional auth header**

In `packages/connectors/src/github_issues.ts`, update `defaultGithubIssueLoader` (lines 14-27):

```typescript
export const defaultGithubIssueLoader: GithubIssueLoader = async (limit: number) => {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json'
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const url = `https://api.github.com/search/issues?q=type:issue+state:open+label:feature+sort:updated&per_page=${limit}`;
  const response = await fetchJsonWithRetry(url, { headers });
  return response.items ?? [];
};
```

**Step 2: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass

**Step 3: Commit**

```bash
git add packages/connectors/src/github_issues.ts
git commit -m "fix: support GITHUB_TOKEN env var for authenticated GitHub API requests"
```

---

### Task 18: Normalize `fetchTheses` return type

The union `ThesisPage | ThesisListItem[]` propagates legacy handling to every call site.

**Files:**
- Modify: `apps/web/src/api.ts:109-125`
- Modify: `apps/web/src/App.tsx`

**Step 1: Normalize inside `fetchTheses`**

In `apps/web/src/api.ts`, update `fetchTheses` to always return `ThesisPage`:

```typescript
export const fetchTheses = async ({
  page = 1,
  pageSize = 10,
  status
}: {
  page?: number;
  pageSize?: number;
  status?: string;
} = {}): Promise<ThesisPage> => {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  if (status) params.set('status', status);
  const response = await fetch(buildApiUrl(`/v1/theses?${params.toString()}`));
  if (!response.ok) throw new Error('Failed to load theses');
  const data = await response.json();

  // Normalize legacy flat array response to ThesisPage
  if (Array.isArray(data)) {
    return {
      items: data,
      page: 1,
      page_size: data.length,
      total_items: data.length,
      total_pages: 1,
      has_next: false,
      has_prev: false
    };
  }
  return data as ThesisPage;
};
```

**Step 2: Remove `Array.isArray` guards from App.tsx**

In `apps/web/src/App.tsx`, find both places that check `Array.isArray(tp)` and simplify to just use the `ThesisPage` type directly:

```typescript
// In the main polling effect:
const tp = await fetchTheses({ page: requestedThesisPage, pageSize: 10 });
setTheses(tp.items);
setThesisPageInfo({
  page: tp.page,
  pageSize: tp.page_size,
  totalItems: tp.total_items,
  totalPages: tp.total_pages,
  hasNext: tp.has_next,
  hasPrev: tp.has_prev
});
```

Do the same in `handleRunAgent`.

**Step 3: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass

**Step 4: Commit**

```bash
git add apps/web/src/api.ts apps/web/src/App.tsx
git commit -m "fix: normalize fetchTheses to always return ThesisPage, remove duplicate Array.isArray guards"
```

---

### Task 19: Fix HNSW index on nullable embedding column

The index includes rows where `embedding IS NULL`, which can degrade index performance or cause errors with some pgvector versions.

**Files:**
- Create: `apps/api/db/migrations/0011_fix_journal_embed_index.sql`

**Step 1: Create the migration**

Create `apps/api/db/migrations/0011_fix_journal_embed_index.sql`:

```sql
-- Fix: HNSW index should be partial, excluding NULL embeddings
DROP INDEX IF EXISTS agent_journal_embed_idx;
CREATE INDEX agent_journal_embed_idx ON agent_journal
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
```

**Step 2: Commit**

```bash
git add apps/api/db/migrations/0011_fix_journal_embed_index.sql
git commit -m "fix: make agent_journal HNSW index partial (WHERE embedding IS NOT NULL)"
```

---

### Task 20: Fix `loadWarning` never clearing and thesis pagination `isLoading` gate

Two small frontend bugs: stale warnings and unguarded pagination buttons.

**Files:**
- Modify: `apps/web/src/App.tsx`

**Step 1: Clear `loadWarning` on successful fetch**

In the main polling effect in `apps/web/src/App.tsx`, find the warning logic (around line 210-219). Ensure that when `warnings.length === 0`, we always clear:

```typescript
if (warnings.length === 0) {
  failCountRef.current = 0;
  setLoadWarning(null);
}
```

Verify this already exists. If it does, check that the log SSE effect (lines 236-319) doesn't interfere — if it sets `loadWarning` on log fetch failure, ensure it also clears on success.

**Step 2: Gate thesis pagination on `isLoading`**

In the thesis pagination buttons (around lines 441-457), add `isLoading` to the disabled condition:

```tsx
<button
  disabled={!thesisPageInfo.hasPrev || isLoading}
  onClick={() => setRequestedThesisPage((v) => Math.max(1, v - 1))}
>
  Prev
</button>
```

```tsx
<button
  disabled={!thesisPageInfo.hasNext || isLoading}
  onClick={() => setRequestedThesisPage((v) => v + 1)}
>
  Next
</button>
```

**Step 3: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass

**Step 4: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "fix: clear loadWarning on recovery and gate thesis pagination on isLoading"
```

---

### Task 21: Push PR 2

**Step 1: Create branch and push**

```bash
cd /Users/vladimirtrifonov/src/ai/idea.ai
git checkout -b feature/v1-medium-fixes
git push -u origin feature/v1-medium-fixes
```

**Step 2: Create PR**

```bash
gh pr create --title "fix: medium bug fixes from v1 audit" --body "$(cat <<'EOF'
## Summary
- Use Ollama embeddings for similarity queries (was local hash mismatch)
- Share single pg.Pool between main.ts and live_read_model
- Add data retention cleanup job (90 days)
- Close journal store pool in shutdown
- Separate thesis fetch from bulk 7-endpoint polling
- Move AgentRunResult type to shared contracts
- Add Codex fallback retry in dual_analyst
- Support GITHUB_TOKEN for authenticated GitHub API calls
- Normalize fetchTheses return type (remove union)
- Fix HNSW index to partial (WHERE embedding IS NOT NULL)
- Clear stale loadWarning, gate thesis pagination on isLoading

## Test plan
- [x] All existing tests pass
- [ ] Manual: verify similarity search returns relevant results (not random)
- [ ] Manual: check pg_stat_activity shows reduced connection count
- [ ] Manual: thesis page change only hits /v1/theses endpoint (check network tab)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" --base dev
```

**Step 3: Merge PR**

```bash
gh pr merge --squash --delete-branch
git checkout dev && git pull
```

---

## PR 3: Dead Code Cleanup

---

### Task 22: Remove dead frontend files

Four component/utility files are never imported anywhere.

**Files:**
- Delete: `apps/web/src/components/AiHealthPanel.tsx`
- Delete: `apps/web/src/components/ConnectorStatus.tsx`
- Delete: `apps/web/src/components/StatusCards.tsx`
- Delete: `apps/web/src/idea.ts`

**Step 1: Delete the files**

```bash
cd /Users/vladimirtrifonov/src/ai/idea.ai
rm apps/web/src/components/AiHealthPanel.tsx
rm apps/web/src/components/ConnectorStatus.tsx
rm apps/web/src/components/StatusCards.tsx
rm apps/web/src/idea.ts
```

**Step 2: Run tests to verify nothing breaks**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass (no imports means no breakage)

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove dead frontend components (AiHealthPanel, ConnectorStatus, StatusCards, idea.ts)"
```

---

### Task 23: Remove dead API files

`bootstrap/queues.ts` (Redis queue infra never invoked) and `scheduler.ts` (never called from main.ts).

**Files:**
- Delete: `apps/api/src/bootstrap/queues.ts`
- Delete: `apps/api/src/jobs/scheduler.ts`
- Delete: `apps/api/tests/scheduler.test.ts` (tests dead code)

**Step 1: Delete the files**

```bash
cd /Users/vladimirtrifonov/src/ai/idea.ai
rm apps/api/src/bootstrap/queues.ts
rm apps/api/src/jobs/scheduler.ts
rm apps/api/tests/scheduler.test.ts
```

**Step 2: Check for the bootstrap directory**

```bash
ls apps/api/src/bootstrap/
```

If the directory is now empty, remove it:

```bash
rmdir apps/api/src/bootstrap/
```

**Step 3: Verify no remaining imports**

Search for any imports of these deleted files across the codebase. If found, remove those import lines.

**Step 4: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass (the deleted test for scheduler.ts is gone, one less test to run)

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove dead API modules (queues bootstrap, scheduler) and their tests"
```

---

### Task 24: Remove legacy `buildAgentPrompt`/`parseAgentResponse`

These functions in `research_agent.ts` are only used by `research-agent.test.ts`. The new canonical format is `BroadScanOutput`/`DeepDiveOutput` in `agent_runner.ts`.

**Files:**
- Modify: `apps/api/src/jobs/research_agent.ts:280-339`
- Delete: `apps/api/tests/research-agent.test.ts`

**Step 1: Remove the legacy functions from research_agent.ts**

In `apps/api/src/jobs/research_agent.ts`, delete the `buildAgentPrompt` function (around line 280) and `parseAgentResponse` function (around line 325), plus the `AgentOutput` type if it's only used by those functions.

**Step 2: Delete the legacy test**

```bash
rm apps/api/tests/research-agent.test.ts
```

**Step 3: Verify no other imports**

Search for `buildAgentPrompt` and `parseAgentResponse` across the codebase to confirm no other consumers.

**Step 4: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass (minus the deleted test file)

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove legacy buildAgentPrompt/parseAgentResponse (superseded by BroadScan/DeepDive format)"
```

---

### Task 25: Push PR 3

**Step 1: Create branch and push**

```bash
cd /Users/vladimirtrifonov/src/ai/idea.ai
git checkout -b feature/v1-dead-code-cleanup
git push -u origin feature/v1-dead-code-cleanup
```

**Step 2: Create PR**

```bash
gh pr create --title "chore: dead code cleanup from v1 audit" --body "$(cat <<'EOF'
## Summary
- Remove 4 dead frontend files (AiHealthPanel, ConnectorStatus, StatusCards, idea.ts)
- Remove dead API modules (bootstrap/queues.ts, scheduler.ts) and their tests
- Remove legacy buildAgentPrompt/parseAgentResponse (superseded by BroadScan/DeepDive format)

## Test plan
- [x] All remaining tests pass
- [x] No broken imports (verified with grep)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" --base dev
```

**Step 3: Merge PR**

```bash
gh pr merge --squash --delete-branch
git checkout dev && git pull
```

---

## PR 4: Test Coverage

---

### Task 26: Test agent run trigger flow

`handleRunAgent` has zero test coverage: button click, loading state, refresh, result display.

**Files:**
- Modify: `apps/web/tests/app.test.tsx`

**Step 1: Add mock for `POST /v1/agent/run`**

In `apps/web/tests/app.test.tsx`, update `buildMockFetch` to handle the agent run POST:

```typescript
if (url.includes('/v1/agent/run') && (input instanceof Request ? input.method === 'POST' : false)) {
  return Promise.resolve(new Response(JSON.stringify({
    thesesUpdated: 3,
    newCandidates: 1,
    alerts: [],
    investigateNext: 'AI agent governance',
    journalEntriesWritten: 4,
    clustersAnalyzed: 5,
    deepDivesPerformed: 2
  }), { status: 200 }));
}
```

Note: Since `fetch` is called with a string URL and options object (not a `Request` instance), detect POST by adding a second parameter or checking the call arguments. Alternatively, match on `/v1/agent/run` and always return the mock since GET is handled by `/v1/agent/status`.

**Step 2: Write the test**

```typescript
it('triggers agent run and shows result', async () => {
  vi.stubGlobal('EventSource', undefined);
  const mockFetch = buildMockFetch();
  vi.stubGlobal('fetch', mockFetch);

  render(<App />);

  // Wait for initial data load
  await screen.findByText('SOC2 prep copilot');

  // Find and click the Run button
  const runButton = screen.getByRole('button', { name: /Run/i });
  expect(runButton).toBeDefined();
  fireEvent.click(runButton);

  // Verify "Running..." state appears (button text changes)
  expect(await screen.findByText(/Running/i)).toBeDefined();
});
```

**Step 3: Run test**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run apps/web/tests/app.test.tsx`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/web/tests/app.test.tsx
git commit -m "test: add agent run trigger flow test coverage"
```

---

### Task 27: Test ThesisCard edge cases

Only one shallow test exists. Add tests for isActive, onClick, scope badge, and confidence colors.

**Files:**
- Modify: `apps/web/tests/thesis-card.test.tsx`

**Step 1: Add comprehensive tests**

```typescript
it('applies thesis-active class when isActive is true', () => {
  const { container } = render(
    <ThesisCard
      thesis={{
        canonicalKey: 'test',
        title: 'Test Thesis',
        confidence: 50,
        status: 'watching',
        evidenceCount: 2,
        problemStatement: 'Test problem',
        sourceCount: 1
      }}
      isActive={true}
    />
  );

  expect(container.querySelector('.thesis-active')).toBeTruthy();
});

it('calls onClick when card is clicked', () => {
  const handleClick = vi.fn();
  render(
    <ThesisCard
      thesis={{
        canonicalKey: 'test',
        title: 'Clickable',
        confidence: 60,
        status: 'watching',
        evidenceCount: 1,
        problemStatement: 'Click me',
        sourceCount: 1
      }}
      onClick={handleClick}
    />
  );

  fireEvent.click(screen.getByText('Clickable'));
  expect(handleClick).toHaveBeenCalledOnce();
});

it('renders scope badge for small/medium/large', () => {
  const { rerender } = render(
    <ThesisCard
      thesis={{
        canonicalKey: 's',
        title: 'Small App',
        confidence: 90,
        status: 'promoted',
        evidenceCount: 8,
        problemStatement: 'p',
        sourceCount: 2,
        estimatedScope: 'small'
      }}
    />
  );
  expect(screen.getByText('S')).toBeTruthy();

  rerender(
    <ThesisCard
      thesis={{
        canonicalKey: 'm',
        title: 'Medium App',
        confidence: 50,
        status: 'watching',
        evidenceCount: 3,
        problemStatement: 'p',
        sourceCount: 1,
        estimatedScope: 'medium'
      }}
    />
  );
  expect(screen.getByText('M')).toBeTruthy();

  rerender(
    <ThesisCard
      thesis={{
        canonicalKey: 'l',
        title: 'Large App',
        confidence: 30,
        status: 'candidate',
        evidenceCount: 1,
        problemStatement: 'p',
        sourceCount: 1,
        estimatedScope: 'large'
      }}
    />
  );
  expect(screen.getByText('L')).toBeTruthy();
});

it('handles null estimatedScope without rendering badge', () => {
  render(
    <ThesisCard
      thesis={{
        canonicalKey: 'n',
        title: 'No Scope',
        confidence: 45,
        status: 'candidate',
        evidenceCount: 1,
        problemStatement: 'p',
        sourceCount: 1,
        estimatedScope: null
      }}
    />
  );

  expect(screen.queryByText('S')).toBeNull();
  expect(screen.queryByText('M')).toBeNull();
  expect(screen.queryByText('L')).toBeNull();
});

it('clamps confidence bar at 100%', () => {
  const { container } = render(
    <ThesisCard
      thesis={{
        canonicalKey: 'over',
        title: 'Over 100',
        confidence: 120,
        status: 'promoted',
        evidenceCount: 15,
        problemStatement: 'p',
        sourceCount: 5
      }}
    />
  );

  const fill = container.querySelector('.thesis-confidence-fill') as HTMLElement;
  expect(fill.style.width).toBe('100%');
});
```

**Step 2: Add missing imports**

Add `fireEvent` and `vi` to the imports at the top of the file if not already there.

**Step 3: Run test**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run apps/web/tests/thesis-card.test.tsx`
Expected: All PASS

**Step 4: Commit**

```bash
git add apps/web/tests/thesis-card.test.tsx
git commit -m "test: add ThesisCard edge case tests (isActive, onClick, scope badge, confidence clamp)"
```

---

### Task 28: Test SignalRow expand/collapse and breakdown chips

The reasoning toggle and pain/timing/buildability chips are untested.

**Files:**
- Create: `apps/web/tests/signal-row.test.tsx`

**Step 1: Create the test file**

```typescript
// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
// biome-ignore lint/correctness/noUnusedImports: React must be in scope for JSX
import React from 'react';
import { describe, expect, it } from 'vitest';
import { SignalRow } from '../src/components/SignalRow';

const baseSignal = {
  idea: 'SOC2 prep copilot',
  score: 82,
  top_source: 'hacker_news',
  snippet: 'Compliance blockers found',
  source_url: 'https://example.com',
  next_action: 'validate_demand' as const,
  updated_at: new Date().toISOString()
};

describe('SignalRow', () => {
  it('renders signal title, score, source, and snippet', () => {
    render(<SignalRow signal={baseSignal} />);

    expect(screen.getByText('SOC2 prep copilot')).toBeTruthy();
    expect(screen.getByText('82')).toBeTruthy();
    expect(screen.getByText('hacker_news')).toBeTruthy();
    expect(screen.getByText(/Compliance blockers/i)).toBeTruthy();
  });

  it('renders breakdown chips when pain/timing/buildability are present', () => {
    render(
      <SignalRow signal={{ ...baseSignal, pain: 72, timing: 61, buildability: 55 }} />
    );

    expect(screen.getByText('72')).toBeTruthy();
    expect(screen.getByText('61')).toBeTruthy();
    expect(screen.getByText('55')).toBeTruthy();
    expect(screen.getByText('Pain')).toBeTruthy();
    expect(screen.getByText('Timing')).toBeTruthy();
    expect(screen.getByText('Build')).toBeTruthy();
  });

  it('hides breakdown chips when scores are absent', () => {
    render(<SignalRow signal={baseSignal} />);

    expect(screen.queryByText('Pain')).toBeNull();
    expect(screen.queryByText('Timing')).toBeNull();
    expect(screen.queryByText('Build')).toBeNull();
  });

  it('toggles reasoning on click', () => {
    render(
      <SignalRow signal={{ ...baseSignal, reasoning: 'This signal indicates strong demand.' }} />
    );

    expect(screen.queryByText(/strong demand/i)).toBeNull();

    fireEvent.click(screen.getByText('Show reasoning'));
    expect(screen.getByText(/strong demand/i)).toBeTruthy();

    fireEvent.click(screen.getByText('Hide reasoning'));
    expect(screen.queryByText(/strong demand/i)).toBeNull();
  });

  it('hides reasoning toggle when no reasoning provided', () => {
    render(<SignalRow signal={baseSignal} />);

    expect(screen.queryByText('Show reasoning')).toBeNull();
  });

  it('renders source link when source_url is present', () => {
    render(<SignalRow signal={baseSignal} />);

    const link = screen.getByRole('link', { name: /Source/i });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('https://example.com');
  });
});
```

**Step 2: Run test**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run apps/web/tests/signal-row.test.tsx`
Expected: All PASS

**Step 3: Commit**

```bash
git add apps/web/tests/signal-row.test.tsx
git commit -m "test: add SignalRow tests (breakdown chips, reasoning toggle, source link)"
```

---

### Task 29: Test `GET /v1/theses/:key` happy path

The thesis detail endpoint's success path is untested (only 404 is covered).

**Files:**
- Modify: `apps/api/tests/theses-api.test.ts` (or create if it doesn't exist — check first)

**Step 1: Check existing test file**

Read `apps/api/tests/theses-api.test.ts` to see what's already tested.

**Step 2: Add happy path test**

```typescript
it('GET /v1/theses/:key returns thesis when found', async () => {
  // Setup: upsert a thesis into the store
  await store.upsert({
    canonicalKey: 'test-thesis-key',
    title: 'Test Thesis',
    topic: 'testing',
    status: 'watching',
    confidence: 75,
    scoreTotal: 75,
    problemStatement: 'Testing is important',
    targetBuyer: 'Engineers',
    proposedSolution: 'Better tests',
    evidenceCount: 3,
    avgPain: 60,
    avgTiming: 50,
    avgBuildability: 70,
    latestObservedAt: new Date().toISOString(),
    evidence: []
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/theses/test-thesis-key'
  });

  expect(response.statusCode).toBe(200);
  const body = response.json();
  expect(body.canonicalKey).toBe('test-thesis-key');
  expect(body.title).toBe('Test Thesis');
});
```

**Step 3: Run test**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run apps/api/tests/theses-api.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/api/tests/theses-api.test.ts
git commit -m "test: add GET /v1/theses/:key happy path test"
```

---

### Task 30: Test `GET /v1/infra/status` route

The infra status endpoint has zero test coverage.

**Files:**
- Create: `apps/api/tests/infra-status.test.ts`

**Step 1: Create the test file**

```typescript
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

describe('GET /v1/infra/status', () => {
  it('returns structured health info', async () => {
    const app = await buildServer({
      infraStatusDeps: {
        checkPostgres: async () => true,
        checkOllama: async () => false,
        getEmbeddingStats: async () => ({ total: 100, withEmbedding: 80, fallbackModel: 'nomic-embed-text' })
      }
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/infra/status'
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.postgres).toBe('ok');
    expect(body.ollama).toBe('error');
    expect(body.embeddings.total).toBe(100);
    expect(body.embeddings.withEmbedding).toBe(80);
    expect(body.embeddings.fallbackModel).toBe('nomic-embed-text');

    await app.close();
  });

  it('handles dependency failures gracefully', async () => {
    const app = await buildServer({
      infraStatusDeps: {
        checkPostgres: async () => { throw new Error('connection refused'); },
        checkOllama: async () => { throw new Error('timeout'); },
        getEmbeddingStats: async () => { throw new Error('table missing'); }
      }
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/infra/status'
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.postgres).toBe('error');
    expect(body.ollama).toBe('error');
    expect(body.embeddings.total).toBe(0);

    await app.close();
  });
});
```

**Step 2: Run test**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run apps/api/tests/infra-status.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/api/tests/infra-status.test.ts
git commit -m "test: add infra status endpoint tests (happy path + dependency failures)"
```

---

### Task 31: Test log drawer interaction

The log drawer open/close toggle is untested.

**Files:**
- Modify: `apps/web/tests/app.test.tsx`

**Step 1: Add log drawer test**

```typescript
it('opens and closes log drawer', async () => {
  vi.stubGlobal('EventSource', undefined);
  vi.stubGlobal('fetch', buildMockFetch());

  render(<App />);

  // Wait for app to load
  await screen.findByText('SOC2 prep copilot');

  // Find the log drawer toggle
  const logsButton = screen.getByText(/Logs/i);
  expect(logsButton).toBeDefined();

  // Click to toggle the drawer
  fireEvent.click(logsButton);

  // Verify log entries are visible (the mock log has 'ai judge call failed')
  expect(await screen.findByText(/ai judge call failed/i)).toBeTruthy();
});
```

**Step 2: Run test**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run apps/web/tests/app.test.tsx`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/tests/app.test.tsx
git commit -m "test: add log drawer interaction test"
```

---

### Task 32: Run full test suite and push PR 4

**Step 1: Run all tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run`
Expected: All pass. Count the total — should be higher than the original 184 by the number of new tests added.

**Step 2: Create branch and push**

```bash
cd /Users/vladimirtrifonov/src/ai/idea.ai
git checkout -b feature/v1-test-coverage
git push -u origin feature/v1-test-coverage
```

**Step 3: Create PR**

```bash
gh pr create --title "test: fill coverage gaps from v1 audit" --body "$(cat <<'EOF'
## Summary
- Agent run trigger flow test (handleRunAgent button click, loading state)
- ThesisCard edge cases (isActive, onClick, scope badge, confidence clamp, null scope)
- SignalRow tests (breakdown chips, reasoning toggle, source link)
- GET /v1/theses/:key happy path test
- GET /v1/infra/status tests (happy path + dependency failures)
- Log drawer interaction test

## Test plan
- [x] All tests pass
- [x] New tests cover previously untested UI interactions and API endpoints

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" --base dev
```

**Step 4: Merge PR**

```bash
gh pr merge --squash --delete-branch
git checkout dev && git pull
```

---

## Verification Checklist

After all 4 PRs are merged:

1. `pnpm exec vitest run` — all tests pass (should be ~195+ tests)
2. Apply migrations `0010_retention_policy.sql` and `0011_fix_journal_embed_index.sql`
3. Start server, trigger agent run — verify:
   - Logs show signal text (not IDs) in deep dive context
   - AI judge attempts scoring (check `aiJudgeAttempts` in logs)
   - reddit/producthunt connectors appear in daily run
   - Journal entries use same `runId` as `agent_runs` row
4. Stop server with SIGTERM — verify `agent_runs` row is `completed` or `failed` (not stuck `running`)
5. Web app loads with error boundary active (test by temporarily introducing a render error)
6. Thesis pagination only triggers thesis fetch (check network tab)
7. `loadWarning` clears when fetch recovers
