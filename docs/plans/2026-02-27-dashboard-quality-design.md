# Dashboard Quality Improvements

## Date: 2026-02-27

## Changes

### 1. Infrastructure Status Section (sidebar)
New section showing Postgres, Ollama, and Embeddings status with colored dots.
New API: `GET /v1/infra/status`.

### 2. Research Pipeline Section (replaces Theses list)
Show last run stats: clusters analyzed, signals processed, embedding counts, journal entries.
Extended AgentStatusRecord with pipeline metrics.

### 3. Clickable Signal Titles
Fix source_url: add column to signal_memory, store during ingestion, return in feed query.
Make signal title an `<a>` tag opening source in new tab.

### 4. App Size on Thesis Cards
Add `estimated_scope` (small/medium/large) to AI prompt output and thesis_candidates table.
Display as colored badge on ThesisCard.

### 5. Fix "0 updated" Count
Embedding fallback (already implemented) enables clustering.
Extend sidebar to show clustersAnalyzed and deepDivesPerformed.

## Files

| Area | File | Change |
|------|------|--------|
| Migration | `db/migrations/0008_source_url_scope.sql` | Add source_url to signal_memory, estimated_scope to thesis_candidates |
| Backend | `runtime/postgres_memory_store.ts` | Store/return source_url |
| Backend | `routes/feed.ts` | Use stored source_url |
| Backend | `routes/infra_status.ts` | New endpoint |
| Backend | `contracts/src/api.ts` | InfraStatusRecord, extended AgentStatusRecord, ThesisListItem.estimatedScope |
| Backend | `jobs/research_agent.ts` | Add estimated_scope to prompt |
| Backend | `jobs/agent_runner.ts` | Store estimated_scope |
| Backend | `jobs/thesis_synthesizer.ts` | Add estimatedScope to ThesisDraft |
| Frontend | `components/SignalRow.tsx` | Clickable title |
| Frontend | `components/ThesisCard.tsx` | Scope badge |
| Frontend | `components/Sidebar.tsx` | Infrastructure + Research Pipeline sections |
| Frontend | `api.ts` | New types and fetchInfraStatus |
