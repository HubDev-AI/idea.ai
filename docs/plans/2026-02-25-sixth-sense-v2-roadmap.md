# Sixth Sense V2 Roadmap (Global Brain)

## Purpose
Turn the current memory-aware feed into a long-running autonomous system that:
1. ingests data continuously,
2. keeps historical memory across months,
3. reasons over all history (not only same topic/source),
4. promotes durable SaaS theses with evidence trails.

## Current State (What Exists)
1. Signals are ingested and scored continuously.
2. Memory is persisted in PostgreSQL + pgvector (`signal_memory`, `signal_embeddings`, `trend_windows`).
3. Retrieval influences scoring across executions.
4. Connector and execution failures are logged with graceful fallback.

## Main Gaps
1. Retrieval is scoped by `topic OR source`; it is not global synthesis across all history.
2. Embeddings are local hash vectors; semantic recall quality is limited.
3. There is no dedicated long-horizon synthesis worker that creates durable ideas/theses.
4. There is no lifecycle for hypotheses (candidate -> validated -> stale/rejected).
5. There is no built-in backtest loop that verifies whether promoted ideas later strengthen or decay.

## Target V2 Capabilities
1. Global memory retrieval across all signals with relevance and recency controls.
2. Daily/weekly synthesis job that turns many related signals into a single thesis candidate.
3. Evidence graph linking each thesis to supporting and contradictory signals.
4. Lifecycle scoring and promotion logic for thesis confidence.
5. Historical evaluation and drift tracking so quality improves over time.

## Data Model Additions
1. `thesis_candidates`
2. `thesis_evidence`
3. `thesis_snapshots`
4. `thesis_outcomes`
5. `retrieval_runs`
6. `synthesis_runs`

## Suggested Columns
1. `thesis_candidates`: `id`, `title`, `problem_statement`, `target_buyer`, `proposed_solution`, `status`, `first_seen_at`, `last_seen_at`.
2. `thesis_evidence`: `thesis_id`, `signal_id`, `relation` (`supporting|contradicting|adjacent`), `weight`, `created_at`.
3. `thesis_snapshots`: `thesis_id`, `run_id`, `score_total`, `pain_persistence`, `momentum`, `novelty`, `whitespace`, `buildability`, `captured_at`.
4. `thesis_outcomes`: `thesis_id`, `outcome_type`, `notes`, `recorded_at`.
5. `retrieval_runs`: `run_id`, `strategy_version`, `top_k`, `completed_at`.
6. `synthesis_runs`: `run_id`, `candidate_count`, `promoted_count`, `completed_at`.

## Retrieval Strategy V2
1. Keep two retrieval paths:
2. Path A: local-context retrieval for scoring a signal (`topic/source` weighted).
3. Path B: global retrieval for synthesis (all sources, all topics, with recency decay).
4. Add lexical fallback (`tsvector`) for sparse or noisy embedding results.
5. Add source-quality weighting and duplicate suppression.

## Synthesis Worker (New)
1. Schedule daily synthesis job (`synthesis.daily`).
2. Pull recent + historical candidate signals.
3. Cluster by semantic similarity + recurring pain language.
4. Generate/refresh thesis candidates.
5. Attach top supporting/contradicting evidence links.
6. Write `thesis_snapshots` for trend lines over time.

## Scoring Model V2
1. `pain_persistence`: repeated strong pain across windows.
2. `momentum`: growth of mentions vs baseline.
3. `novelty`: not overcrowded with near-identical ideas.
4. `whitespace`: high pain but low strong incumbency signals.
5. `buildability`: feasibility from judge ensemble.

Proposed blend:
- `score_total = 0.35*pain_persistence + 0.25*momentum + 0.15*novelty + 0.15*whitespace + 0.10*buildability`

## Thesis Lifecycle Rules
1. `candidate`: created from synthesis cluster.
2. `watching`: evidence accumulates but confidence below promotion threshold.
3. `promoted`: confidence and persistence exceed threshold for N runs.
4. `stale`: no reinforcing evidence for M runs.
5. `rejected`: strong contradictory evidence or market saturation.

## API and UI Upgrades
1. New endpoint: `GET /v1/theses` (ranked long-horizon ideas).
2. New endpoint: `GET /v1/theses/:id` (details + evidence + trend snapshots).
3. Keep `/v1/signals` as tactical feed.
4. Add UI mode switch:
5. Mode A: live signals (short horizon).
6. Mode B: thesis board (long horizon).

## Observability Upgrades
1. Persist run-level artifacts for retrieval and synthesis.
2. Add health metrics:
3. `signals_ingested_total`
4. `signals_scored_total`
5. `thesis_candidates_total`
6. `thesis_promoted_total`
7. `connector_failure_rate`
8. `retrieval_empty_rate`
9. Write one summary file per run in `logs/executions`.

## Phase Plan
1. Phase 1: Schema + migrations for thesis tables and run tables.
2. Phase 2: Retrieval V2 (global + lexical fallback + weighting).
3. Phase 3: Synthesis worker and thesis generation.
4. Phase 4: Thesis lifecycle transitions and confidence scoring.
5. Phase 5: New API routes and UI thesis board.
6. Phase 6: Backtesting and drift reports.

## Immediate Next Tasks (Do First)
1. Add migrations for `thesis_candidates`, `thesis_evidence`, `thesis_snapshots`, `retrieval_runs`, `synthesis_runs`.
2. Implement `synthesis.daily` job skeleton and wire into runtime schedule.
3. Implement global retriever query (remove strict `topic/source` restriction for synthesis path).
4. Add `/v1/theses` route with mocked data from DB tables.
5. Add smoke test: a repeated pattern over multiple runs must increase thesis confidence.

## Success Criteria
1. Data persists and remains queryable across restarts and months.
2. Same pattern, when repeated over time, is promoted automatically to a thesis.
3. Every promoted thesis has traceable evidence rows.
4. Stale ideas decay automatically without manual cleanup.
5. Ranking quality improves over time in backtest reports.

