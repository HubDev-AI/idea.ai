# Database-Only State Refactor

> Remove all filesystem state. Everything in PostgreSQL.

## Current State

The app has a hybrid state model:

1. **In-memory `Snapshot` object** (`live_read_model.ts:49-55`) holds scored signals, connector statuses, and refresh timestamps. Rebuilt every refresh cycle. Lost on restart.
2. **`refresh_state` table** (Postgres) persists `lastHourlyRunAt`, `lastDailyRunAt`, `refreshedAt`. Already working.
3. **`signal_memory` table** (Postgres) stores scored signals with embeddings. Already used by the feed API for paginated queries.
4. **`connector_state` table** (Postgres) exists but is empty and unused.
5. **`logs/state/*.json` files** are leftover artifacts from a previous version. Not read or written by current code. Can be deleted.

### What's broken today

- Sidebar signal counts come from `signal_memory.countSignalsBySource()` — but some connectors (App Store, YC Companies) have signals in the in-memory snapshot that never got persisted to `signal_memory` (Ollama was down, or first run before store was ready).
- Connector statuses come from the in-memory snapshot, not from `connector_state` table.
- On restart, signals are lost until next refresh cycle rebuilds them.

## Refactor Plan

### Task 1: Populate `connector_state` table from refresh cycle

**Files:**
- `apps/api/src/runtime/live_read_model.ts` — after each connector runs, upsert into `connector_state`
- `apps/api/src/runtime/postgres_memory_store.ts` — add `upsertConnectorState()` and `listConnectorStates()` methods

**What changes:**
- After `runOpenConnectorIngestionDetailed` returns, write each connector's status/last_run to `connector_state`
- `listConnectors()` reads from `connector_state` table instead of in-memory snapshot
- Remove `connectors` field from in-memory `Snapshot` type

### Task 2: Serve signal counts from database with real-time WebSocket push

**Files:**
- `apps/api/src/ws/state_hub.ts` — `signalCounts` already uses `getSignalCounts()` from `memoryStore.countSignalsBySource()`
- `apps/api/src/runtime/live_read_model.ts` — after persisting signals, emit WebSocket update with fresh counts

**What changes:**
- After each signal is saved to `signal_memory`, increment a dirty flag
- At end of scoring loop, query fresh `countSignalsBySource()` and push via WebSocket `signalCounts` event
- Frontend already listens for `signalCounts` events — no client changes needed
- Total signal count in sidebar header should also come from `signal_memory` COUNT, not snapshot length

### Task 3: Ensure all scored signals reach `signal_memory`

**Files:**
- `apps/api/src/runtime/live_read_model.ts` — scoring loop (lines 755-806)

**What changes:**
- When `embeddingRecord` is null (Ollama down), still save `memoryRecord` to `signal_memory` — just skip the embedding insert (already done after local-hash removal)
- Log a warning when Ollama is unreachable so signals without embeddings are visible
- This ensures App Store, YC Companies, etc. always appear in `signal_memory` even if Ollama is temporarily down

### Task 4: Remove in-memory signal snapshot

**Files:**
- `apps/api/src/runtime/live_read_model.ts` — remove `signals` from `Snapshot` type
- `apps/api/src/routes/feed.ts` — remove in-memory fallback (lines 161-183)

**What changes:**
- `Snapshot` becomes `{ refreshedAt: number; lastHourlyRunAt: number; lastDailyRunAt: number }` — timing only
- `listSignals()` removed from read model — feed route uses `memoryStore.querySignals()` exclusively
- In-memory `FeedRecord[]` array no longer accumulated during scoring
- Signal retention (on hourly-only runs, keep daily signals) handled naturally because `signal_memory` persists across refreshes

### Task 5: Delete filesystem state artifacts

**Files:**
- `logs/state/` — delete entire directory
- `.gitignore` — remove `logs/state/` entry if present

**What changes:**
- Delete `latest_snapshot.json`, `runtime_snapshot.json`, `session_snapshot*.json`
- These files are not read or written by current code — safe to remove

## Result

After refactor:
- **All state in PostgreSQL**: signals, embeddings, connector statuses, refresh timestamps, theses, everything
- **No filesystem state**: restart loses nothing
- **Real-time counts**: sidebar shows live database counts pushed via WebSocket
- **All connectors counted**: signals always persisted regardless of Ollama availability
