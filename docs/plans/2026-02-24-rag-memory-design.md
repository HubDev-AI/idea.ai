# Sixth Sense Local RAG Memory Design

## Goal
Add historical and semantic memory so scoring is not based only on moment snapshots.

## Memory Stack
- Relational store: PostgreSQL
- Vector store: `pgvector` extension in PostgreSQL
- Queue integration: existing event-driven workers

## Core Data Model
- `signal_memory`
  - `id` (uuid, pk)
  - `signal_id` (text, unique)
  - `source` (text)
  - `source_item_id` (text)
  - `observed_at` (timestamptz)
  - `topic` (text)
  - `canonical_text` (text)
  - `pain_score` (numeric)
  - `timing_score` (numeric)
  - `buildability_score` (numeric)
  - `blended_score` (numeric)

- `signal_embeddings`
  - `signal_id` (text, pk, fk -> `signal_memory.signal_id`)
  - `embedding` (vector)
  - `model` (text)
  - `created_at` (timestamptz)

- `trend_windows`
  - `topic` (text)
  - `source` (text)
  - `window` (`7d | 30d | 90d`)
  - `count_signals` (int)
  - `avg_pain` (numeric)
  - `avg_timing` (numeric)
  - `updated_at` (timestamptz)

## Retrieval Flow
1. New normalized signal arrives.
2. Build `canonical_text` from title/snippet/source metadata.
3. Generate embedding and write to `signal_embeddings`.
4. Retrieve top-k similar historical entries by vector distance:
   - same topic first
   - global fallback
5. Read trend baselines from `trend_windows` for 7d/30d/90d.

## Sixth Sense Features
- `novelty_score`: inverse of similarity to prior signals.
- `persistence_score`: repeated pain across windows.
- `momentum_score`: acceleration from 30/90d baseline to 7d.
- `saturation_score`: penalty for overcrowded similar ideas.

## Scoring Integration
- `pain_final = pain_current * 0.70 + persistence_score * 0.30`
- `timing_final = timing_current * 0.40 + momentum_score * 0.60`
- `buildability_final = median(judge1, judge2, judge3)`
- `blended = 0.40 * pain_final + 0.40 * timing_final + 0.20 * buildability_final`

## Worker Additions
- `memory-index` worker: upsert canonical memory + embeddings.
- `memory-window` worker: refresh 7d/30d/90d aggregates.
- scoring workers consume retrieval + trend features.

## Why This Helps
- Avoids overreacting to one-off spikes.
- Promotes recurring unresolved pain.
- Detects early-but-rising patterns.
- Improves recommendation quality using historical analogs.

## Rollout Plan (when implementation starts)
1. Add schema + migrations (`pgvector`, memory tables).
2. Add embedding/index worker.
3. Add retrieval API for scoring workers.
4. Add trend window aggregator job.
5. Wire scores to memory-aware formulas.
6. Add tests for novelty/persistence/momentum behavior.
