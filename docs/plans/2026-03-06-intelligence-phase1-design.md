# Phase 1: Intelligence Foundation — Design Doc

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Bayesian thesis confidence, velocity/acceleration scoring, and developer behavior signal connectors to create the intelligence foundation that makes idea.ai's scoring genuinely predictive.

**Architecture:** Incremental upgrades to existing scoring pipeline and retrieval layer. No new infrastructure — all changes build on PostgreSQL + pgvector + existing connector interface.

**Tech Stack:** TypeScript, PostgreSQL + pgvector, Ollama, existing connector pattern

---

## 1. Bayesian Thesis Confidence Engine

### Problem

The current system rescores theses from scratch on every agent run. A thesis with 3 weeks of accumulated evidence gets the same treatment as a brand-new candidate. There is no concept of "confidence that builds over time."

### Design

Replace point-in-time rescoring with incremental Bayesian updates.

**Data model changes:**

Add columns to `thesis_candidates`:

```sql
ALTER TABLE thesis_candidates ADD COLUMN prior_confidence REAL DEFAULT 0.2;
ALTER TABLE thesis_candidates ADD COLUMN posterior_confidence REAL DEFAULT 0.2;
ALTER TABLE thesis_candidates ADD COLUMN evidence_count INTEGER DEFAULT 0;
ALTER TABLE thesis_candidates ADD COLUMN confirming_signals INTEGER DEFAULT 0;
ALTER TABLE thesis_candidates ADD COLUMN contradicting_signals INTEGER DEFAULT 0;
ALTER TABLE thesis_candidates ADD COLUMN last_updated_at TIMESTAMPTZ DEFAULT NOW();
```

**Update formula:**

For each new signal that matches a thesis (via embedding similarity > threshold):

```
likelihood_ratio = signal_strength_factor(signal)
posterior = prior * likelihood_ratio / normalizer
```

Where `signal_strength_factor` depends on:
- Source independence (HN + Reddit + GitHub = 3 independent sources = higher ratio)
- Signal recency (newer signals have higher likelihood ratio)
- Signal quality (AI-scored demand/timing/buildability)

Concrete likelihood ratios (from research):

| Signal Type | Confirming Ratio | Contradicting Ratio |
|-------------|-----------------|---------------------|
| Multi-source convergence (3+ sources) | 2.2 | 0.4 |
| Single high-quality source | 1.6 | 0.6 |
| GitHub repo growth | 1.7 | 0.7 |
| StackOverflow complaints spike | 1.6 | 0.8 |
| Enterprise tool adoption signal | 2.2 | 0.5 |
| Weak/noisy signal | 1.1 | 0.9 |

**Decay rule:** If no confirming signal arrives for 14 days, apply a daily decay:

```
confidence *= 0.97  (roughly -3%/day, hits 50% of peak after ~23 days of silence)
```

**Configurable via env:**

```
BAYESIAN_PRIOR_DEFAULT=0.2
BAYESIAN_DECAY_RATE=0.97
BAYESIAN_DECAY_AFTER_DAYS=14
BAYESIAN_CONVERGENCE_RATIO=2.2
```

### Integration Point

In `research_agent.ts` during thesis update step:
- Instead of overwriting confidence, compute Bayesian posterior from prior + new evidence
- Store both prior and posterior so the update chain is traceable
- `thesis_snapshots` already captures point-in-time scores — continue using that for trend visualization

### Files to modify

- `apps/api/db/migrations/0015_bayesian_confidence.sql` (new)
- `apps/api/src/jobs/research_agent.ts` — update thesis scoring logic
- `apps/api/src/runtime/postgres_thesis_store.ts` — add Bayesian update method
- `packages/contracts/src/api.ts` — add `posteriorConfidence` to `ThesisListItem`
- `apps/api/src/config/env.ts` — Bayesian config env vars

---

## 2. Velocity and Acceleration Scoring (Temporal RAG)

### Problem

The current scoring model captures a snapshot — "how much pain exists right now." It does not capture momentum — "is this pain growing?" A topic mentioned 10 times this week but 3 times last week (3.3x velocity) is far more interesting than one mentioned 100 times but 95 last week (1.05x velocity).

### Design

**Two additions:**

#### A. Recency decay on pgvector retrieval

Modify the similarity query in `postgres_memory_store.ts`:

```sql
SELECT *,
  (1 - :weight) * (1 - (embedding <=> :query_embedding))
  + :weight * EXP(-LN(2) / :half_life_hours * EXTRACT(EPOCH FROM (NOW() - observed_at)) / 3600)
  AS temporal_score
FROM signal_embeddings
JOIN signal_memory USING (signal_id)
ORDER BY temporal_score DESC
LIMIT :top_k
```

Configurable:

```
TEMPORAL_RAG_WEIGHT=0.3
TEMPORAL_RAG_HALF_LIFE_HOURS=72
```

#### B. Velocity and acceleration dimensions

Add to the scoring pipeline:

```typescript
type VelocityScore = {
  velocity: number;      // 7d count / 30d avg weekly count
  acceleration: number;  // current velocity / previous velocity
};
```

Compute per-topic from `trend_windows` or `signal_memory`:

```sql
WITH weekly AS (
  SELECT
    topic,
    COUNT(*) FILTER (WHERE observed_at > NOW() - INTERVAL '7 days') AS week_count,
    COUNT(*) FILTER (WHERE observed_at > NOW() - INTERVAL '30 days') / 4.0 AS avg_weekly
  FROM signal_memory
  GROUP BY topic
)
SELECT
  topic,
  CASE WHEN avg_weekly > 0 THEN week_count / avg_weekly ELSE 1 END AS velocity
FROM weekly
```

Acceleration requires two consecutive velocity measurements — store velocity in `thesis_snapshots` and compare current vs previous snapshot.

**Blend formula update:**

Current: `demand (25%) + timing (20%) + buildability (20%) + virality (35%)`

Add velocity as a multiplier, not a dimension:

```
final_score = blended_score * velocity_multiplier
velocity_multiplier = CLAMP(0.5 + 0.5 * velocity, 0.5, 2.0)
```

This means:
- Declining topic (velocity < 1): score penalized up to 50%
- Stable topic (velocity = 1): no change
- Growing topic (velocity > 1): score boosted up to 2x

### Files to modify

- `apps/api/src/runtime/postgres_memory_store.ts` — temporal retrieval query
- `apps/api/src/jobs/score.ts` — add velocity multiplier
- `apps/api/src/jobs/research_agent.ts` — compute velocity per cluster
- `apps/api/src/config/env.ts` — temporal RAG and velocity config
- `packages/pipeline/src/scoring/blend.ts` — velocity multiplier

---

## 3. Developer Behavior Signal Connectors

### Problem

Current connectors capture what developers *say* (HN comments, Reddit posts). They miss what developers *do* (install packages, create workarounds, ask unanswered questions). Behavioral signals are stronger predictors of real pain.

### Design

Three new connectors, all using free APIs with no auth:

#### A. npm Download Trends Connector

**API:** `https://api.npmjs.org/downloads/point/last-week/{package}`

**Cadence:** Weekly (new cadence type, or run as daily with 7-day lookback)

**Strategy:**
1. Maintain a curated list of ~200 packages across 15 categories (auth, payments, AI/ML, database, monitoring, DevOps, etc.)
2. Track week-over-week download changes
3. Flag categories where multiple packages show >50% growth simultaneously
4. Flag packages with explosive growth but <100 GitHub stars (early adoption signal)

**Category seed list** (stored in config, expandable):

```typescript
const NPM_CATEGORIES: Record<string, string[]> = {
  'ai-agents': ['langchain', 'llamaindex', 'crewai', 'autogen'],
  'vector-db': ['chromadb', 'pinecone', 'weaviate-client', 'qdrant-js'],
  'auth': ['lucia', 'better-auth', 'clerk', 'auth0'],
  'payments': ['stripe', 'lemonsqueezy', 'paddle-sdk'],
  // ... ~15 categories
};
```

**Output event format:**

```typescript
{
  source: 'npm_trends',
  source_item_id: `npm:${category}:${week}`,
  text: `Category "${category}" showing ${growth}% weekly growth. Top movers: ${packages}. This suggests growing developer adoption in ${category} tools.`,
  url: `https://npmtrends.com/${topPackage}`,
}
```

#### B. StackOverflow Unanswered Questions Connector

**API:** `https://api.stackexchange.com/2.3/questions/unanswered` (free, 300 req/day without key, 10K/day with free key)

**Cadence:** Daily

**Strategy:**
1. Track tags with growing unanswered question counts
2. Flag tags where unanswered/total ratio is increasing (developers asking but nobody has answers = pain)
3. Extract "workaround" patterns from accepted answers

**Query parameters:** `tagged={tag}&sort=creation&order=desc&site=stackoverflow`

**Tags to monitor:** Map to existing connector categories + new tech categories

#### C. Semantic Scholar Connector

**API:** `https://api.semanticscholar.org/graph/v1/paper/search` (free, 5K req/5min)

**Cadence:** Weekly

**Strategy:**
1. Search for papers in tech categories relevant to SaaS
2. Track citation velocity — papers whose citation count is accelerating indicate research becoming actionable
3. Flag papers transitioning from academic venues to engineering/industry venues (arxiv -> blog posts)

**Query:** `query={topic}&year=2024-2026&fieldsOfStudy=Computer Science&fields=title,abstract,citationCount,year,venue`

### Files to create

- `packages/connectors/src/npm_trends.ts`
- `packages/connectors/src/stackoverflow.ts` (may already exist — extend if so)
- `packages/connectors/src/semantic_scholar.ts`

### Files to modify

- `packages/connectors/src/common/http.ts` — add to OPEN_CONNECTOR_CADENCE
- `apps/api/src/jobs/ingest_open.ts` — wire new connectors
- `apps/api/src/runtime/live_read_model.ts` — add to OPEN_CONNECTORS list
- `apps/api/src/config/env.ts` — connector-specific env vars
- `.env.example` — document new connector env vars

---

## 4. Cross-Source Correlation Matrix

### Problem

The current multi-source convergence detection works signal-by-signal (embedding similarity). It misses theme-level convergence — when the same *problem category* appears across independent source types.

### Design

Add a theme correlation check to the research agent:

```typescript
type SourceCategory = 'developer' | 'market' | 'academic' | 'enterprise' | 'consumer';

const SOURCE_CATEGORIES: Record<string, SourceCategory> = {
  github_issues: 'developer',
  stackoverflow: 'developer',
  npm_trends: 'developer',
  hn: 'developer',
  reddit: 'consumer',
  producthunt: 'market',
  appstore_trending: 'market',
  yc_companies: 'market',
  semantic_scholar: 'academic',
  g2_reviews: 'enterprise',
  greenhouse: 'enterprise',
  lever: 'enterprise',
};
```

For each thesis cluster, count how many *independent source categories* contributed signals:

```
corroboration_score = unique_source_categories / total_categories
```

A thesis with signals from developer + market + enterprise (3/5 categories) gets much higher confidence than one with signals only from developer sources (1/5).

### Integration

Add `source_categories` and `corroboration_score` to thesis snapshots. Use corroboration as a likelihood ratio multiplier in the Bayesian update.

---

## Success Criteria

1. Thesis confidence increases incrementally with each confirming signal (not rescored from scratch)
2. Thesis confidence decays naturally when no new evidence arrives
3. Rapidly growing topics score higher than stable ones at the same absolute volume
4. npm/StackOverflow/Semantic Scholar connectors produce actionable signals
5. Cross-source corroboration visibly boosts thesis confidence
6. All new config values are env-var-driven (no magic numbers)
7. All existing tests continue to pass

---

## Risks

| Risk | Mitigation |
|------|------------|
| Bayesian priors miscalibrated | Reset priors weekly; validate against full rescoring |
| Velocity scoring rewards noise spikes | Require minimum signal volume before velocity applies |
| npm category list becomes stale | LLM-assisted category refresh quarterly |
| StackOverflow rate limits | Use free API key (10K/day), cache aggressively |
| Semantic Scholar results too academic | Filter for papers with industry co-authors or engineering venues |
