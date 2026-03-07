# Closing the Feedback Loops — Design

**Goal:** Wire two remaining Phase 4 gaps: (1) optimized weights feed into actual scoring, (2) agent AI calls use primary-with-fallback instead of dual-parallel.

**Constraints:** No new tables, no new endpoints, no UI changes. Purely backend wiring.

---

## Item 1: Dynamic Weights in Scoring Pipeline

### Problem
`blendedScore()` uses hardcoded weights (demand 25%, timing 20%, buildability 20%, virality 35%). The weight optimizer finds better weights and stores them in `scoring_weight_history`, but they're never used for actual scoring. The system doesn't learn from its predictions.

### Solution
Replace `blendedScore()` calls with `blendedScoreWithWeights()` using weights loaded from DB via `getActiveWeights(pool, profileId)`.

### Data Flow
1. Weight optimizer runs weekly, stores optimized weights in `scoring_weight_history`
2. On each scoring batch, call `getActiveWeights(pool, 'consumer')` once (one DB query)
3. Pass returned weights to `blendedScoreWithWeights()` instead of `blendedScore()`
4. Falls back to profile defaults automatically (built into `getActiveWeights`)

### Call Sites
- `apps/api/src/runtime/live_read_model.ts:729` — signal scoring during ingestion
- `apps/api/src/jobs/score.ts:57` — AI post-scrape scoring

### Changes
- Both call sites need access to `pool` (to query `scoring_weight_history`)
- Import `getActiveWeights` from `apps/api/src/runtime/active_weights.ts`
- Import `blendedScoreWithWeights` from `@idea/pipeline/src/scoring/blend`
- Load weights once per batch, use for all signals in that batch

---

## Item 2: Primary-with-Fallback in Agent Runner

### Problem
`dualAnalystRun` calls both Claude and Codex in parallel for every AI task, wasting double the API calls. The intended behavior is primary-with-fallback: call preferred provider first, only call the other if it fails.

### Solution
Change `dualAnalystRun` to sequential primary-then-fallback. Keep all existing retry logic intact.

### New Flow
1. Call preferred provider (e.g., Claude)
2. If it succeeds and parses, return immediately (only `claude` field populated)
3. If it fails, call fallback provider (e.g., Codex)
4. If fallback succeeds and parses, return (only `codex` field populated)
5. If both fail, run existing retry block: Claude retry -> Codex retry -> Claude retry

### What Stays the Same
- `DualResult<T>` return type (still has `claude` and `codex` fields)
- All retry logic when both providers fail
- `reconcileScores` function (still exported, still available)
- All callers (`agent_runner.ts`) — no changes needed, they already use `pickPreferred`

### Files
- `packages/ai-runtime/src/dual_analyst.ts` — change parallel to sequential with fallback

### Not In Scope
- Model router is NOT used for expensive agent tasks (thesis synthesis, debate, deep-dive). Those continue to use direct CLI calls. Router handles cheap/medium tasks only (entity extraction).
- No stats changes needed.

---

## Files Touched

| File | Change |
|------|--------|
| `packages/ai-runtime/src/dual_analyst.ts` | Sequential primary-then-fallback |
| `apps/api/src/runtime/live_read_model.ts` | Dynamic weights via `getActiveWeights` |
| `apps/api/src/jobs/score.ts` | Dynamic weights via `getActiveWeights` |
