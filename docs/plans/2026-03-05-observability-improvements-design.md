# Observability Improvements Design

## Problem

The UI and logs don't distinguish between the connector refresh (hourly/daily signal ingestion) and the research agent (thesis synthesis). Users see log activity but can't tell what system produced it or whether it's still running. Specific symptoms:

1. Connector refresh logs show `[live_read_model]` with no cadence label — looks like "only 3 sources" when it's actually just the hourly refresh
2. Research agent runs (automatic via timer) have no UI visibility — `agentRunning` is frontend-only state set by the Run button
3. Countdown timer shows "22 min left" while connector refresh is actively producing logs — confusing because it looks like the agent should be running
4. No clear boundaries between runs in the log stream — everything blends together

## Design: Backend Running State + Labeled Logs

### 1. Agent status API: add `isRunning` flag

**`GET /v1/agent/status`** response changes:

```typescript
type AgentStatusRecord = {
  isRunning: boolean;          // NEW: true when executeAgentRun() is in-flight
  lastRun: { ... } | null;
  investigateNext: string | null;
};
```

Backend: set `isRunning = true` when `agentRunInFlight` is non-null in `main.ts`.

Frontend: derive `agentRunning` from BOTH the local button state AND the polled `agentStatus.isRunning`. This means automatic backend runs also show loading in the sidebar.

### 2. Connector refresh status: add `refreshing` cadence

**`GET /v1/connectors/refresh-meta`** response changes:

```typescript
type RefreshMeta = {
  last_hourly_run: string | null;
  last_daily_run: string | null;
  hourly_interval_ms: number;
  daily_interval_ms: number;
  refreshing: 'hourly' | 'daily' | null;  // NEW: which cadence is currently running
};
```

Backend: the `live_read_model` sets `refreshing` when a refresh cycle starts and clears it when done. The 15-second poll picks this up.

Frontend: show "refreshing..." text next to the active cadence group instead of the countdown timer.

### 3. Label all logs with system and cadence

Every log entry gets a clear system tag in the component field:

| Current component | New component | When |
|---|---|---|
| `live_read_model` | `hourly_refresh` | During hourly connector ingestion |
| `live_read_model` | `daily_refresh` | During daily connector ingestion |
| `ingest_open` | `hourly_refresh` / `daily_refresh` | Connector-level logs inherit cadence |
| `ingest_byo` | `byo_refresh` | BYO connector ingestion |
| `ai_post_scrape` | `hourly_refresh` / `daily_refresh` | AI post-scrape inherits cadence |
| `agent_runner` | `agent_run` | Already labeled, keep as-is |
| `dual_analyst` | `agent_run` | Already labeled, keep as-is |

Add run boundary markers:
- `[INFO] [hourly_refresh] === HOURLY REFRESH START ===`
- `[INFO] [hourly_refresh] === HOURLY REFRESH COMPLETE === (58 signals, 5m 15s)`
- `[INFO] [agent_run] === AGENT RUN START ===`
- `[INFO] [agent_run] === AGENT RUN COMPLETE === (4 updated, 6 new, 3m 42s)`

### 4. Countdown behavior during active runs

- When `agentStatus.isRunning` is true: sidebar shows "Running..." instead of countdown
- When `refreshMeta.refreshing` is set: the matching cadence group shows "Refreshing..." instead of countdown
- Countdown resumes from the new timestamp after completion

### 5. Filter noise from logs

The 16 individual `signal skipped by ai post-scrape noise filter` DEBUG entries are noise. Aggregate them:
- Instead of 16 individual lines, log one summary: `[hourly_refresh] ai post-scrape filtered 17 noisy signals`
- Keep the individual entries at TRACE level (not shown in UI by default)

## Files to change

| File | Change |
|---|---|
| `packages/contracts/src/api.ts` | Add `isRunning` to `AgentStatusRecord`, add `refreshing` to `RefreshMeta` |
| `apps/api/src/main.ts` | Set `isRunning` based on `agentRunInFlight !== null` |
| `apps/api/src/runtime/live_read_model.ts` | Track refreshing cadence, pass cadence label to logger, add boundary markers |
| `apps/api/src/runtime/execution_logger.ts` | No changes needed (component field already flexible) |
| `apps/web/src/App.tsx` | Derive `agentRunning` from polled status, show refresh state |
| `apps/web/src/components/Sidebar.tsx` | Show "Running..." / "Refreshing..." states, pause countdown |
| `apps/web/src/api.ts` | Update types |

## Out of scope

- Run timeline / collapsible groups (nice-to-have, not now)
- WebSocket push for state changes (polling every 15s is fine)
- Per-connector loading state (cadence-level is enough)
