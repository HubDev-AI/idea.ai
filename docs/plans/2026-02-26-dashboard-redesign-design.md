# Dashboard Redesign & DB-Backed Feed Design

**Date:** 2026-02-26
**Status:** Approved
**Scope:** Layout restructure, DB-backed rolling feed, thesis filtering

## Context

The dashboard has a sidebar-based layout that wastes horizontal space for signals. The feed shows only the latest refresh's signals (~31) despite hundreds being persisted in `signal_memory`. Thesis cards are non-interactive single-line summaries.

## Changes

### 1. Layout: Full-Width Signals

Remove the 240px AgentSidebar. Replace the 2-column grid (sidebar + feed) with:

```
Hero (unchanged)
├── Top Theses (3 cards, clickable)
├── Status Cards Row: [Connectors] [AI Agents] [Research Agent]
├── Opportunity Signals (full width, paginated)
└── Runtime Logs (collapsible)
```

The three status cards form a compact horizontal row with equal widths. Each shows a summary with key metrics. Research Agent info moves from the sidebar into its own card.

### 2. DB-Backed Rolling Feed (7 days)

Replace the in-memory snapshot feed with a direct Postgres query:

- New API: `GET /v1/signals?window=7d&page=1&page_size=20`
- Query `signal_memory` table with `WHERE observed_at >= NOW() - INTERVAL '7 days'`
- Order by `blended DESC` (highest score first)
- Support source filter: `&source=hn`
- Support thesis filter: `&thesis_key=remote-dev-tools` (joins through `thesis_evidence`)
- Keep existing pagination

The live_read_model still refreshes and persists new signals. The feed just reads from the DB instead of the snapshot.

### 3. Thesis Click-to-Filter

Clicking a thesis card:
- Sets a `thesisFilter` state with the thesis `canonicalKey`
- Shows a filter banner above signals: "Showing signals for: {thesis title} [x clear]"
- Feed API filters through `thesis_evidence` JOIN to only show linked signals
- Clicking [x] or clicking the same thesis again clears the filter

### 4. Enhanced Thesis Cards

Thesis cards show more info:
- Title (already shown)
- Confidence bar (already shown)
- Problem statement (already shown, but truncated)
- Evidence count + source count
- Average pain/timing/buildability scores
- Click behavior: filter signals (above)

### 5. Compact Status Cards

Three equal-width cards in a row:

**Connector Health card:**
- List connectors with status dots and last-run time
- Same info as current ConnectorStatus, just in card format

**AI Agents card:**
- Provider status dots (claude/codex)
- Succeeded/failed counts
- Same info as current AiHealthPanel, condensed

**Research Agent card:**
- Last run timestamp
- Theses updated / new candidates
- Next investigation target
- Same info as current AgentSidebar, in card format

## API Changes

### Modified: `GET /v1/signals`

New query parameters:
- `window`: Duration string (default `7d`). Options: `1d`, `7d`, `30d`, `all`
- `source`: Filter by source name
- `thesis_key`: Filter by thesis canonical key (via thesis_evidence JOIN)

Response shape unchanged (SignalPage).

### New: `GET /v1/theses/:key/signals`

Alternative endpoint that returns signals linked to a thesis via evidence table.

## Files to Modify

**Backend:**
- `apps/api/src/routes/feed.ts` — DB query instead of snapshot, new filters
- `apps/api/src/runtime/postgres_memory_store.ts` — new `querySignals()` method
- `apps/api/src/server.ts` — pass pool/store to feed route

**Frontend:**
- `apps/web/src/App.tsx` — remove sidebar grid, add status cards row, thesis filter state
- `apps/web/src/components/AgentSidebar.tsx` → rename to `StatusCards.tsx` or split into 3 cards
- `apps/web/src/components/ThesisCard.tsx` — add click handler, show more detail
- `apps/web/src/components/SignalRow.tsx` — minor: full-width adjustments
- `apps/web/src/styles.css` — new layout grid, status card styles
- `apps/web/src/api.ts` — update fetch calls with new query params

## Success Criteria

- Signals show 7-day rolling window from DB (typically 200+ signals)
- Clicking thesis filters to its evidence signals with clear button
- Status cards show all monitoring info in compact horizontal row
- Signals take full page width
- All existing tests pass + new tests for DB feed query
