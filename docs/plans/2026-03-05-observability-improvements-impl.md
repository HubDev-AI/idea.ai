# Observability Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the UI and logs clearly distinguish between connector refreshes and agent runs, with reliable loading states for both.

**Architecture:** Add `isRunning` to agent status API and `refreshing` to refresh-meta API so the frontend can show accurate loading states for background-triggered processes. Relabel all log components with cadence context and add run boundary markers. Aggregate noisy debug lines.

**Tech Stack:** TypeScript, Fastify, React, PostgreSQL

---

### Task 1: Add `isRunning` to agent status API

**Files:**
- Modify: `packages/contracts/src/api.ts:150-161` (AgentStatusRecord type)
- Modify: `apps/api/src/main.ts:53,157` (getAgentStatus lambda)
- Modify: `apps/web/src/App.tsx:86,210,402-448` (agentRunning state derivation)
- Modify: `apps/web/src/components/Sidebar.tsx:224-226` (countdown display)

**Step 1: Add `isRunning` to the contract type**

In `packages/contracts/src/api.ts`, add `isRunning` to `AgentStatusRecord`:

```typescript
export type AgentStatusRecord = {
  isRunning: boolean;
  lastRun: {
    timestamp: string;
    thesesUpdated: number;
    newCandidates: number;
    clustersAnalyzed: number;
    deepDivesPerformed: number;
    journalEntriesWritten: number;
    provider: string | null;
  } | null;
  investigateNext: string | null;
};
```

**Step 2: Set `isRunning` in the backend**

In `apps/api/src/main.ts`, update the initial status and `getAgentStatus`:

Change line 53 from:
```typescript
let agentStatus: AgentStatusRecord = { lastRun: null, investigateNext: null };
```
to:
```typescript
let agentStatus: AgentStatusRecord = { isRunning: false, lastRun: null, investigateNext: null };
```

Change `getAgentStatus` (line 157) from:
```typescript
getAgentStatus: () => agentStatus,
```
to:
```typescript
getAgentStatus: () => ({ ...agentStatus, isRunning: agentRunInFlight !== null }),
```

Also update the `agentStatus` assignments inside `executeAgentRun` (around line 112) to include `isRunning: false`:
```typescript
agentStatus = {
  isRunning: false,
  lastRun: { ... },
  investigateNext: result.investigateNext || null
};
```

And update the DB hydration block (around line 61) to include `isRunning: false`:
```typescript
agentStatus = {
  isRunning: false,
  lastRun: { ... },
  investigateNext: row.investigate_next
};
```

**Step 3: Derive `agentRunning` from polled status in the frontend**

In `apps/web/src/App.tsx`, the `agentRunning` state should be true if EITHER the user clicked Run OR the polled status says `isRunning`.

Keep the local `agentRunning` state for the button-triggered case. Add a derived value:

After the agent status poll update (line ~210), add:
```typescript
if (agentResult.status === 'fulfilled') {
  setAgentStatus(agentResult.value);
  // If backend reports running but we didn't trigger it, sync local state
  if (agentResult.value.isRunning && !agentRunning) {
    setAgentRunning(true);
  }
  // If backend reports not running but we think it is (auto-run finished), sync
  if (!agentResult.value.isRunning && agentRunning && !manualRunRef.current) {
    setAgentRunning(false);
  }
}
```

Add a ref to track manual vs automatic:
```typescript
const manualRunRef = useRef(false);
```

In `handleRunAgent`, set `manualRunRef.current = true` before the await, and reset it in the finally block.

**Step 4: Show "Running..." in sidebar countdown when agent is active**

In `apps/web/src/components/Sidebar.tsx`, the countdown area (lines 224-226) currently shows the countdown or "due". When `agentRunning` is true, show "Running..." instead. This already works via the existing `agentRunning` prop — the sidebar already shows "Running..." when `agentRunning` is true (line 235).

No sidebar change needed — the fix is fully in App.tsx syncing the state.

**Step 5: Verify**

Run: `pnpm --filter @idea/web run build`
Expected: Build succeeds with no type errors.

Run: `CI=1 pnpm test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add packages/contracts/src/api.ts apps/api/src/main.ts apps/web/src/App.tsx
git commit -m "feat: add isRunning to agent status API for reliable loading state"
```

---

### Task 2: Add `refreshing` cadence to refresh-meta API

**Files:**
- Modify: `packages/contracts/src/api.ts:47-52` (RefreshMeta type)
- Modify: `apps/api/src/runtime/live_read_model.ts:499-522,622-637,1074-1082` (track refreshing state)
- Modify: `apps/web/src/components/Sidebar.tsx:142-149` (show refreshing state)

**Step 1: Add `refreshing` to the contract type**

In `packages/contracts/src/api.ts`:

```typescript
export type RefreshMeta = {
  last_hourly_run: string | null;
  last_daily_run: string | null;
  hourly_interval_ms: number;
  daily_interval_ms: number;
  refreshing: 'hourly' | 'daily' | null;
};
```

**Step 2: Track refreshing cadence in live_read_model**

In `apps/api/src/runtime/live_read_model.ts`, add a mutable variable near line 507:

```typescript
let refreshingCadence: 'hourly' | 'daily' | null = null;
```

At the start of the `refresh` function (line 622), after the `logger.info('refresh started')` call, set:
```typescript
// Determine which cadence this refresh covers
const dailyDue = forceCadence === 'daily' || (!forceCadence && Date.now() - snapshot.lastDailyRunAt >= DAILY_CADENCE_MS);
refreshingCadence = dailyDue ? 'daily' : (forceCadence === 'daily' ? 'daily' : 'hourly');
```

Note: move the `dailyDue` calculation up before the `refreshingCadence` assignment (it's currently at line 646). The existing `const DAILY_CADENCE_MS` is at line 645 — move both up.

At the end of refresh (in the `finally` equivalent — after `persistSnapshotToDisk` at line 994 and in the error catch at line 1003), reset:
```typescript
refreshingCadence = null;
```

The cleanest way: wrap the refresh body in try/finally:
```typescript
const refresh = async (forceCadence?: 'hourly' | 'daily'): Promise<Snapshot> => {
  // ... setup ...
  refreshingCadence = dailyDue ? 'daily' : 'hourly';
  try {
    // ... existing body ...
  } finally {
    refreshingCadence = null;
  }
};
```

**Step 3: Expose `refreshing` in getRefreshMeta**

In `apps/api/src/runtime/live_read_model.ts` at line 1077, update `getRefreshMeta`:

```typescript
getRefreshMeta: () => ({
  last_hourly_run: new Date(snapshot.lastHourlyRunAt > 0 ? snapshot.lastHourlyRunAt : startedAt).toISOString(),
  last_daily_run: new Date(snapshot.lastDailyRunAt > 0 ? snapshot.lastDailyRunAt : startedAt).toISOString(),
  hourly_interval_ms: refreshMs,
  daily_interval_ms: DAILY_CADENCE_MS,
  refreshing: refreshingCadence,
}),
```

**Step 4: Show "Refreshing..." in sidebar**

In `apps/web/src/components/Sidebar.tsx`, update the countdown display for each cadence group (around line 147-148):

```typescript
const isRefreshing = refreshMeta?.refreshing === cadence;
// ...
<span className={`sidebar-countdown ${countdown === 'now' || isRefreshing ? 'refreshing' : ''}`}>
  {isRefreshing ? 'refreshing\u2026' : countdown === null ? 'pending' : countdown === 'now' ? 'refreshing\u2026' : countdown}
</span>
```

**Step 5: Update the connectors route default response**

In `apps/api/src/routes/connectors.ts` line 29, add `refreshing: null`:

```typescript
return { last_hourly_run: null, last_daily_run: null, hourly_interval_ms: 3600000, daily_interval_ms: 86400000, refreshing: null };
```

**Step 6: Verify**

Run: `pnpm --filter @idea/web run build`
Expected: Build succeeds.

Run: `CI=1 pnpm test`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add packages/contracts/src/api.ts apps/api/src/runtime/live_read_model.ts apps/api/src/routes/connectors.ts apps/web/src/components/Sidebar.tsx
git commit -m "feat: add refreshing cadence to refresh-meta API for connector loading state"
```

---

### Task 3: Label logs with system/cadence and add boundary markers

**Files:**
- Modify: `apps/api/src/runtime/live_read_model.ts:622-1000` (component labels and boundary logs)
- Modify: `apps/api/src/jobs/ingest_open.ts` (pass cadence to logger component)

**Step 1: Add cadence-labeled boundary markers to refresh**

In `apps/api/src/runtime/live_read_model.ts`, at the start of the `refresh` function (after determining `dailyDue`), replace the existing `refresh started` log:

```typescript
const cadenceLabel = dailyDue ? 'daily_refresh' : 'hourly_refresh';
await logger.info(cadenceLabel, `=== ${dailyDue ? 'DAILY' : 'HOURLY'} REFRESH START ===`, {
  run_id: logger.runId,
  hourly_connectors: skipHourly ? [] : enabledOpenConnectors('hourly', env).join(', '),
  daily_connectors: dailyDue ? enabledOpenConnectors('daily', env).join(', ') : 'skipped'
});
```

At the end of refresh (line 996), replace `refresh completed`:

```typescript
const durationMs = Date.now() - now; // `now` is already defined at line 939
await logger.info(cadenceLabel, `=== ${dailyDue ? 'DAILY' : 'HOURLY'} REFRESH COMPLETE ===`, {
  run_id: logger.runId,
  events: events.length,
  published_signals: snapshot.signals.length,
  duration_s: Math.round(durationMs / 1000)
});
```

Note: `now` is defined at line 939 but the start time is needed earlier. Add `const refreshStartedAt = Date.now();` near the top of refresh, then use it for duration.

**Step 2: Relabel all `live_read_model` component names inside refresh**

Replace all `'live_read_model'` component strings inside the `refresh` function body with `cadenceLabel`. This includes:

- `event selection prepared` (line 673)
- `signal skipped by ai post-scrape noise filter` (line 738) — but see Task 4 for aggregation
- `signal skipped because ai opportunity rewrite is unavailable` (line 751)
- `signal skipped because title appears low-value without ai rewrite` (line 762)
- `ai judge summary` (line 923)
- `idea candidate detected` (line 961)
- `no idea candidate detected` (line 970)
- `no fresh signals, serving previous snapshot` (line 957)
- `convergence boost applied` (line 886)
- `signal scoring failed` (line 915)
- `persistent memory save failed` (line 895)

For each, change the component from `'live_read_model'` to `cadenceLabel`.

The hydration and persistence logs (`loaded persisted snapshot`, `failed to load persisted snapshot`, `failed to persist snapshot`) stay as `'live_read_model'` since they're not cadence-specific.

**Step 3: Verify**

Run: `CI=1 pnpm test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add apps/api/src/runtime/live_read_model.ts
git commit -m "feat: label refresh logs with cadence and add boundary markers"
```

---

### Task 4: Aggregate noise filter debug logs

**Files:**
- Modify: `apps/api/src/runtime/live_read_model.ts:732-743` (aggregate noise filter logs)

**Step 1: Replace individual noise filter debug logs with aggregate**

Currently lines 736-743 log one DEBUG entry per filtered signal. Replace with a collector:

Before the `for (const input of selectedSignalInputs)` loop, add:
```typescript
const noiseFilteredSignals: Array<{ source: string; id: string; confidence: number | null }> = [];
```

Inside the `if (aiInsight?.isNoise)` block, replace the `await logger.debug(...)` with:
```typescript
noiseFilteredSignals.push({
  source: event.source,
  id: String(event.source_item_id),
  confidence: aiInsight.confidence ?? null
});
```

After the loop (before the `ai judge summary` log), add a single aggregate log:
```typescript
if (noiseFilteredSignals.length > 0) {
  const bySource = noiseFilteredSignals.reduce<Record<string, number>>((acc, s) => {
    acc[s.source] = (acc[s.source] ?? 0) + 1;
    return acc;
  }, {});
  await logger.info(cadenceLabel, 'ai post-scrape noise filtered', {
    filtered_count: noiseFilteredSignals.length,
    by_source: bySource
  });
}
```

**Step 2: Verify**

Run: `CI=1 pnpm test`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add apps/api/src/runtime/live_read_model.ts
git commit -m "feat: aggregate noise filter logs into single summary entry"
```

---

### Task 5: Update frontend to show running/refreshing states

**Files:**
- Modify: `apps/web/src/App.tsx` (sync agentRunning with polled status)
- Modify: `apps/web/src/components/Sidebar.tsx` (refreshing indicator, running indicator)
- Test: manual verification — restart API, trigger refresh, verify UI shows correct states

**Step 1: Add `manualRunRef` and sync agent running state from poll**

In `apps/web/src/App.tsx`, add after `const failCountRef`:
```typescript
const manualRunRef = useRef(false);
```

In the main poll's agent status handler (inside the `if (agentResult.status === 'fulfilled')` block around line 210):
```typescript
if (agentResult.status === 'fulfilled') {
  setAgentStatus(agentResult.value);
  if (agentResult.value.isRunning && !agentRunning) {
    setAgentRunning(true);
  }
  if (!agentResult.value.isRunning && agentRunning && !manualRunRef.current) {
    setAgentRunning(false);
  }
}
```

In `handleRunAgent`:
```typescript
const handleRunAgent = async () => {
  manualRunRef.current = true;
  setAgentRunning(true);
  // ... existing code ...
  } finally {
    manualRunRef.current = false;
    setAgentRunning(false);
  }
};
```

**Step 2: Pass refreshMeta to sidebar (already passed)**

The sidebar already receives `refreshMeta` prop. The `refreshing` field will be available after Tasks 1-2.

**Step 3: Update sidebar countdown for refreshing cadence**

In `apps/web/src/components/Sidebar.tsx`, inside the cadence group map (around line 142):

```typescript
const isRefreshing = refreshMeta?.refreshing === cadence;
```

Update the countdown span:
```typescript
<span className={`sidebar-countdown ${countdown === 'now' || isRefreshing ? 'refreshing' : ''}`}>
  {isRefreshing ? 'refreshing\u2026' : countdown === null ? 'pending' : countdown === 'now' ? 'refreshing\u2026' : countdown}
</span>
```

**Step 4: Verify build**

Run: `pnpm --filter @idea/web run build`
Expected: Build succeeds.

Run: `CI=1 pnpm test`
Expected: All tests pass.

**Step 5: Manual verification**

1. Restart API server
2. Open http://localhost:5173/
3. Wait for an hourly refresh to trigger — verify sidebar shows "refreshing..." next to the hourly cadence group
4. Trigger a manual agent run via Run button — verify "Running..." stays visible until completion
5. Check logs — verify boundary markers like `=== HOURLY REFRESH START ===` appear
6. Verify no individual noise filter debug lines — only aggregate summary

**Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/Sidebar.tsx
git commit -m "feat: sync frontend loading states with backend running/refreshing indicators"
```
