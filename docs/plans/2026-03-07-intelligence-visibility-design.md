# Phase 4: Intelligence Visibility — Design

**Goal:** Wire dormant Phase 3 infrastructure (entity graph, model router, experience library, weight optimization loop) into the live pipeline AND surface all hidden intelligence to the UI via new tabs/drawers.

**Approach:** Vertical slices — each slice wires one backend loop and ships its corresponding UI, so every slice delivers visible value independently.

**Constraints:** Additive only. No changes to existing UI layout (split panes + drawers). No breaking changes to current pipeline. New views added as drawer tabs or modal tabs.

---

## Slice 1: Score Explainability

### Problem
Thesis confidence scores are a black box. Users can't see why a thesis scored high or low — no visibility into weight contributions, debate arguments, or evidence quality.

### Backend
- New endpoint: `GET /v1/theses/:key/explain`
- Returns:
  - **Weight breakdown**: component scores (demand, timing, buildability, virality, velocity) multiplied by active weights = blended score
  - **Debate summary**: latest bull case, bear case, moderator verdict from `thesis_debates` table
  - **Bayesian trail**: prior confidence, likelihood updates from debates, current posterior
  - **Top evidence**: 5 strongest supporting signals with their individual scores
- Data sources: `thesis_candidates`, `thesis_debates`, `signal_memory` — all exist, no new tables

### Frontend
- New tab in deep-dive modal: "Why this score?"
- Stacked horizontal bar: weight contribution per dimension (e.g. demand 25% = 18.5 pts)
- Debate card: bull case (green border) vs bear case (red border), verdict badge (strong_opportunity / contested / etc.)
- Confidence sparkline: posterior value over time from debate history

### Tables Used
- `thesis_candidates` (posterior_confidence, demand, timing, buildability, virality, velocity)
- `thesis_debates` (bull_case, bear_case, moderator_verdict)
- `signal_memory` (evidence signals by ID)

---

## Slice 2: Self-Improving Weights

### Problem
Weight optimizer runs on schedule but its output never feeds back into the scoring pipeline. Experience library table exists but is never populated. The system doesn't actually learn from its predictions.

### Backend Wiring
1. **Weight feedback loop**: After `runWeightOptimization` finds better weights (> 5% improvement), store in `scoring_weight_history` AND make them available to `blend.ts`
2. **Dynamic weight loading**: Add `getActiveWeights(profileId)` to query latest optimized weights from DB, falling back to profile defaults. Called at start of each agent run.
3. **Experience population**: In `backtest_validate.ts`, when a thesis is confirmed validated (found on ProductHunt/YC after prediction), write the thesis trajectory (signal summary, reasoning, output, outcome) to `experience_library` table via `experienceStore.record()`

### Frontend
- New drawer tab: **"Scoring Health"** (alongside Opportunity Map, Logs)
- **Current weights**: per-profile weight display with "optimized" or "default" badge
- **Optimization history**: table showing past weight sets from `scoring_weight_history` with precision, recall, sample_size
- **Prediction track record**: validated count / total predictions = accuracy %, from `thesis_predictions`
- **Experience library size**: count of stored trajectories for few-shot learning

### Tables Used
- `scoring_weight_history` (demand_weight, timing_weight, ..., precision_score, sample_size)
- `thesis_predictions` (outcome_validated, confidence_at_prediction)
- `experience_library` (thesis_key, outcome_validated)

---

## Slice 3: Knowledge Graph + Connections View

### Problem
Entity extraction code exists but is never called. The knowledge graph tables are empty. Users can't see relationships between opportunities (e.g. "3 theses address the same DevOps pain point" or "this emerging tech enables 5 different ideas").

### Backend Wiring
1. **Entity extraction in pipeline**: After AI post-scrape, run entity extraction on top N scored signals per batch (configurable: `ENTITY_EXTRACT_BATCH_SIZE`, default 10)
2. **Model router for extraction**: Entity extraction is a "medium" task — route through Ollama 7B via model router (first real activation of dormant router)
3. **Entity store in agent runner**: Pass `entityStore` into agent deps so entity data is available during thesis synthesis
4. **New API endpoints**:
   - `GET /v1/entities` — paginated entity list, filterable by type (pain_point, technology, market, competitor, trend), sorted by mention_count
   - `GET /v1/entities/insights` — pre-computed: unaddressed pains (`findUnaddressedPains`), emerging tech (`findEmergingTech`), most-connected entities

### Frontend
- New drawer tab: **"Connections"** (alongside Opportunity Map, Logs, Scoring Health)
- **Unaddressed Pains**: `pain_point` entities with no `addresses` relation — whitespace opportunities
- **Emerging Tech**: `technology` entities with high recent mention velocity
- **Entity List**: searchable/filterable table with type badge, mention count, first/last seen
- Clicking entity expands inline to show relations (enables, competes_with, addresses, etc.) — no graph visualization library, just a relation list

### Tables Used
- `entities` (entity_type, name, mention_count, first/last_seen_at)
- `entity_relations` (source_entity_id, target_entity_id, relation_type, confidence)

### Missing Index (from audit)
- Add: `CREATE INDEX idx_thesis_debates_key_created ON thesis_debates(thesis_key, created_at DESC)`

---

## Slice 4: Model Router Integration

### Problem
All AI calls go through Claude CLI regardless of task complexity. Model router was built in Phase 3 but never wired. Ollama sits idle while Claude handles noise classification.

### Backend Wiring
- Replace direct `runClaude`/`runCodex` calls with `modelRouter.run(task, input)`:
  - **Noise gate classification** → Ollama cheap (llama3.2:3b)
  - **Entity extraction** → Ollama medium (qwen2.5:7b)
  - **Thesis synthesis** → Claude CLI (expensive)
  - **Debate roles** → Claude CLI (expensive)
  - **Deep-dive generation** → Claude CLI (expensive)
- Add counters to router: `ollamaCalls`, `ollamaSucceeded`, `cliCalls`, `cliSucceeded`
- Extend `GET /v1/ai-health` response with `routerStats` object (no new endpoint)

### Frontend
- Add "Model Routing" section to existing **AI Health sidebar panel**
- Shows: Ollama vs CLI call counts, estimated savings %, fallback count
- No new drawer tab — enriches existing sidebar

### Env Vars
- `MODEL_ROUTING_ENABLED` (already exists, default false)
- `OLLAMA_CHEAP_MODEL` (already exists)
- `OLLAMA_MEDIUM_MODEL` (already exists)
- `OLLAMA_TASK_TIMEOUT_MS` (already exists)

---

## Delivery Order

| # | Slice | Key Outcome | New UI |
|---|-------|-------------|--------|
| 1 | Score Explainability | Black box → transparent | Modal tab |
| 2 | Self-Improving Weights | Feedback loops close | Drawer tab |
| 3 | Knowledge Graph + Connections | Hidden relationships surface | Drawer tab |
| 4 | Model Router | Cost reduction via Ollama | Sidebar section |

Each slice is independent and ships value alone. Recommended order is 1→2→3→4 (increasing complexity, decreasing user-facing impact).

## New Migration

- `0025_debates_composite_index.sql` — adds missing composite index on `thesis_debates(thesis_key, created_at DESC)`

## New Env Vars

- `ENTITY_EXTRACT_BATCH_SIZE` (default 10) — signals per batch for entity extraction

## Files Touched Per Slice

### Slice 1
- Create: `apps/api/src/routes/thesis_explain.ts`
- Modify: `apps/api/src/server.ts` (register route)
- Modify: `packages/contracts/src/api.ts` (ThesisExplainRecord type)
- Create: `apps/web/src/components/ThesisExplainTab.tsx`
- Modify: `apps/web/src/components/ThesisDeepDiveModal.tsx` (add tab)
- Modify: `apps/web/src/styles.css` (explain tab styles)

### Slice 2
- Modify: `packages/pipeline/src/scoring/blend.ts` (dynamic weight loading)
- Modify: `apps/api/src/jobs/backtest_validate.ts` (experience population)
- Modify: `apps/api/src/main.ts` (pass experienceStore to backtest)
- Create: `apps/api/src/routes/scoring_health.ts`
- Modify: `apps/api/src/server.ts` (register route)
- Modify: `packages/contracts/src/api.ts` (ScoringHealthRecord type)
- Create: `apps/web/src/components/ScoringHealth.tsx`
- Modify: `apps/web/src/App.tsx` (add drawer tab)
- Modify: `apps/web/src/styles.css`

### Slice 3
- Modify: `apps/api/src/main.ts` (wire entity extraction + model router)
- Modify: `apps/api/src/jobs/agent_runner.ts` (entity store in deps)
- Create: `apps/api/src/routes/entities.ts`
- Modify: `apps/api/src/server.ts` (register route)
- Modify: `packages/contracts/src/api.ts` (EntityRecord, EntityInsights types)
- Create: `apps/web/src/components/ConnectionsView.tsx`
- Modify: `apps/web/src/App.tsx` (add drawer tab)
- Modify: `apps/web/src/styles.css`
- Modify: `apps/api/src/config/env.ts` (ENTITY_EXTRACT_BATCH_SIZE)
- Create: `apps/api/db/migrations/0025_debates_composite_index.sql`

### Slice 4
- Modify: `apps/api/src/main.ts` (pass router to pipeline)
- Modify: `apps/api/src/jobs/agent_runner.ts` (use router)
- Modify: `packages/ai-runtime/src/router.ts` (add counters)
- Modify: `apps/api/src/routes/ai_health.ts` (include router stats)
- Modify: `packages/contracts/src/api.ts` (RouterStats type)
- Modify: `apps/web/src/App.tsx` (router stats in AI Health panel)
