# Audit Remediation Design

**Date:** 2026-03-09
**Source:** `docs/research/2026-03-09-app-api-audit.md`
**Scope:** `apps/web`, `apps/api`, shared contracts/runtime
**Delivery:** One PR against `dev`

---

## Overview

Address all 9 issues (3 P1, 6 P2) and 5 refactoring candidates identified in the March 9 audit. Changes are grouped by subsystem to keep diffs coherent and reviewable. No behavior changes beyond the fixes — all refactoring is semantics-preserving.

---

## Group 1: Auth Layer

Fixes P1 #1 (Socket.IO unauthenticated), P1 #3 (HTTP control plane public by default), P2 #4 (transport model inconsistency).

### Server

**`apps/api/src/ws/state_hub.ts`**
Add a Socket.IO middleware that reads `socket.handshake.auth.key` and validates it against `env.apiKey`. If `apiKey` is set and the key does not match, call `next(new Error('Unauthorized'))` and disconnect. If `apiKey` is not set, skip the check (local dev mode).

**`apps/api/src/main.ts`**
- Replace the wildcard-origin fallback in Socket.IO CORS config with an explicit `ALLOWED_ORIGINS` env var (comma-separated). Default: `http://localhost:5173`.
- On startup: if `API_KEY` is unset and `HOST !== '127.0.0.1'`, throw and refuse to start. This enforces auth for any non-localhost binding, while preserving the local dev zero-config experience.

**Prompt/output preview stripping**
Remove raw prompt/output fields from the data emitted over WebSocket in:
- `apps/api/src/jobs/agent_runner.ts:304-307` and `:514-518`
- `apps/api/src/jobs/deep_dive_generator.ts:87-90`
- `apps/api/src/jobs/ai_post_scrape.ts:220-227`

Execution logs (file-based) are unaffected — only the wire-level broadcast is trimmed.

**`.env` and `.env.example`**
Add `ALLOWED_ORIGINS=http://localhost:5173` to both files.

### Web client

**`apps/web/src/api.ts`**
Add a `getApiKey()` helper returning `import.meta.env.VITE_API_KEY ?? ''`. Inject it as `X-Api-Key` header in every fetch call (omit header if value is empty so unauthenticated local dev still works without config).

**`apps/web/src/useSocket.ts`**
Pass `auth: { key: import.meta.env.VITE_API_KEY ?? '' }` in the Socket.IO constructor options.

**`.env.example`**
Add `VITE_API_KEY=` with comment: `# Must match API_KEY in apps/api/.env`.

**`.env` (web)**
Add `VITE_API_KEY=` (empty by default, matching no-auth local dev).

---

## Group 2: URL Safety

Fixes P1 #2 (untrusted upstream URLs rendered as clickable anchors).

**`apps/api/src/runtime/postgres_signal_store.ts`**
Add `sanitizeUrl(url: string | null | undefined): string | null` at the top of the file. Parses the URL; returns it unchanged if scheme is `http:` or `https:`, otherwise returns `null`. Apply to `source_url` before every `INSERT`. Bad URLs never reach the database.

**`apps/web/src/components/SignalRow.tsx`**
Defense-in-depth: before setting `href`, check that `signal.source_url` starts with `http:` or `https:`. If not, render the link text as plain text without an anchor.

---

## Group 3: Backend Logic

Fixes P2 #5 (refresh guard bypass), P2 #6 (deep-dive dedupe), P2 #7 (stats filter mismatch), P2 #8 (stale sidebar counts).

### P2 #5 — Refresh guard

**`apps/api/src/runtime/live_read_model.ts`**
Remove `refresh` from the exported surface (the returned object). Only `startRefresh` is public. `startRefresh` returns `false` if a refresh is already running, so callers can detect and respond to contention.

**`apps/api/src/routes/connectors.ts`**
Replace the `readModel.refresh(cadence)` call with `readModel.startRefresh(cadence)`. If it returns `false`, respond with HTTP 409.

### P2 #6 — Deep-dive dedupe

**`apps/api/src/routes/theses.ts`**
Add a module-level `const inFlightDives = new Map<string, Promise<DeepDiveResult>>()`. On POST:
1. If `key` is in the map, await the existing promise and return its result.
2. Otherwise, create the promise, store it keyed by `key`, await it, delete from map on settle (resolve or reject), return result.

Concurrent callers for the same thesis share one LLM call.

### P2 #7 — Stats query filter

**`apps/api/src/runtime/postgres_thesis_store.ts`**
Apply the same `where` clause and `countParams` to the `statsResult` query (lines 233–248) that are already applied to `countResult`. Stats now describe the same filtered dataset as the listed rows.

### P2 #8 — Stale sidebar counts

**`apps/api/src/ws/state_hub.ts`**
Include `signalCount` and `latestSignalAt` in every live broadcast alongside the existing `signalCounts`, `thesisStats`, and `signalsUpdated` fields. The sidebar no longer falls back to the stale initial snapshot value.

---

## Group 4: UI Fix

Fixes P2 #9 (nested `<button>` in log drawer).

**`apps/web/src/App.tsx`**
Restructure the log drawer header. Make the outer toggle a `<div>` with `onClick`, `onKeyDown` (Enter/Space), `role="button"`, and `tabIndex={0}`. The inner copy/action button remains a real `<button>` — now valid because it is no longer nested inside another button.

---

## Group 5: Refactoring

Semantics-preserving consolidation of five duplication clusters. No behavior changes.

### R1 — Frontend HTTP client

**`apps/web/src/api.ts`**
Expose `apiFetch(path: string, options?: RequestInit): Promise<Response>` — a thin wrapper that applies `VITE_API_URL` base URL and `X-Api-Key` header. This reuses work already done in the auth layer fix.

**`apps/web/src/components/ScoringHealth.tsx`, `ConnectionsView.tsx`, `OpportunityMap.tsx`**
Replace ad-hoc `fetch()` calls with `apiFetch`. Error handling and base URL logic become consistent.

### R2 — Thesis projection SQL

**`apps/api/src/runtime/postgres_thesis_store.ts`**
Extract the repeated aggregate/select shape into a `THESIS_SELECT_COLS` constant string. Reference it at all four query sites (`:80-93`, `:100-110`, `:118-136`, `:268-290`).

### R3 — Shared persistence helpers

**`apps/api/src/runtime/db_utils.ts`** (new file)
Move `toVectorLiteral` here. Import it in signal and journal persistence files.

Declare `EXEC_LOG_DIR` once in `execution_logger.ts` and import it in `execution_log_reader.ts`.

### R4 — ThesisCard contract type

**`apps/web/src/components/ThesisCard.tsx`**
Import `ThesisListItem` from `packages/contracts/src/api.ts` instead of re-declaring the fields locally. Adjust any field name mismatches.

### R5 — Dynamic profile sources in ScoringHealth

**`apps/web/src/components/ScoringHealth.tsx`**
Accept profiles as a prop (or read from context) instead of hardcoding `['consumer', 'b2b']`. `App.tsx` already fetches the profile list — pass it down.

---

## Constraints

- All refactoring is behavior-preserving. Run `CI=1 pnpm test` after each group before moving to the next.
- The auth layer changes must not break unauthenticated local dev (no `API_KEY` set, `HOST=127.0.0.1`).
- The URL sanitizer must handle `null`/`undefined` inputs without throwing.
- The deep-dive promise map must delete entries on both resolve and reject to avoid memory leaks.
- `THESIS_SELECT_COLS` extraction must produce identical SQL output to the existing inline strings.
