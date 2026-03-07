# Phase 2: Intelligence Amplification — Design Doc

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add adversarial agent debate, backtesting engine, category creation detection, and supply/demand imbalance mapping to dramatically improve thesis quality and create provable prediction accuracy.

**Architecture:** Extends Phase 1 foundations (Bayesian confidence, velocity scoring, new connectors). Adds new agent reasoning patterns and a retrospective validation loop.

**Tech Stack:** TypeScript, PostgreSQL + pgvector, Claude/Codex CLI, Ollama

**Prerequisite:** Phase 1 complete (Bayesian confidence, velocity scoring, developer behavior connectors)

---

## 1. Adversarial Agent Debate

### Problem

The current `dualAnalystRun` sends the same prompt to both Claude and Codex in parallel. Both providers tend toward optimism — LLMs are trained to be helpful and will find opportunities even in weak signals. This creates systematic overconfidence in thesis scoring.

### Design

Replace the parallel-same-task pattern with a structured debate:

```
Bull Agent (Advocate)     →  argues FOR the opportunity
Bear Agent (Critic)       →  argues AGAINST it
Moderator Agent (Judge)   →  weighs both arguments, assigns final confidence
```

**Agent roles and prompts:**

```typescript
type DebateRole = 'bull' | 'bear' | 'moderator';

const BULL_SYSTEM = `You are a startup opportunity analyst. Your job is to make the strongest possible case for why this thesis represents a real, buildable SaaS opportunity. Cite specific evidence from the signals provided. Be specific about market size, timing, and competitive advantage.`;

const BEAR_SYSTEM = `You are a skeptical VC partner. Your job is to find every reason this thesis will FAIL. Consider: Is the market too small? Are incumbents too strong? Is the timing wrong? Is this a hype cycle? Is the pain real or manufactured? Be ruthlessly honest.`;

const MODERATOR_SYSTEM = `You are a senior investment committee chair. You have received a bull case and a bear case for a startup thesis. Weigh both arguments objectively. Output a JSON object with: confidence (0-1), bull_strength (0-100), bear_strength (0-100), missing_evidence (array of strings), verdict (one of: "strong_opportunity", "needs_investigation", "likely_noise", "contested").`;
```

**Execution flow:**

```
1. Bull agent receives: thesis + supporting signals → produces bull_case
2. Bear agent receives: thesis + supporting signals + bull_case → produces bear_case
3. Moderator receives: thesis + bull_case + bear_case → produces verdict
```

Sequential, not parallel — the bear sees the bull case and must counter it specifically.

**Provider assignment:**

```typescript
// Rotate who plays bull vs bear to avoid provider bias
const round = debateRoundCount % 2;
const bullProvider = round === 0 ? 'claude' : 'codex';
const bearProvider = round === 0 ? 'codex' : 'claude';
// Moderator always uses the more capable provider
const moderatorProvider = 'claude';
```

**Cost control:**

Only run debates on theses that pass an initial confidence threshold:

```
DEBATE_CONFIDENCE_THRESHOLD=0.4   // Only debate theses above 40% confidence
DEBATE_MAX_PER_RUN=5              // Max debates per agent run
```

This means ~15 AI calls per run for debates (3 per thesis x 5 theses), on top of existing agent calls.

**Output integration:**

The moderator's verdict feeds into the Bayesian update:

| Verdict | Likelihood Ratio |
|---------|-----------------|
| strong_opportunity | 2.5 |
| needs_investigation | 1.3 |
| contested | 0.8 |
| likely_noise | 0.3 |

Store debate transcripts in a new table for transparency:

```sql
CREATE TABLE thesis_debates (
  id SERIAL PRIMARY KEY,
  thesis_key TEXT NOT NULL REFERENCES thesis_candidates(canonical_key),
  run_id TEXT NOT NULL,
  bull_provider TEXT NOT NULL,
  bear_provider TEXT NOT NULL,
  bull_case TEXT NOT NULL,
  bear_case TEXT NOT NULL,
  moderator_verdict JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Files to modify/create

- `apps/api/db/migrations/0016_thesis_debates.sql` (new)
- `apps/api/src/jobs/thesis_debate.ts` (new) — debate orchestration
- `apps/api/src/jobs/research_agent.ts` — integrate debate step after clustering
- `apps/api/src/config/env.ts` — debate config env vars
- `packages/contracts/src/api.ts` — add debate verdict to thesis detail response

---

## 2. Backtesting Engine

### Problem

The system has no way to know if its predictions are good. Without retroactive validation, scoring weights are arbitrary guesses that never improve.

### Design

**Core loop:**

```
1. Snapshot thesis predictions weekly
2. After 30/60/90 days, check if the predicted opportunity materialized
3. Compute prediction accuracy metrics
4. Feed accuracy data back to scoring weights
```

**Validation signals** (did the opportunity actually happen?):

| Signal | Source | Weight |
|--------|--------|--------|
| New ProductHunt launch in thesis category | ProductHunt connector | Strong |
| New YC company in thesis space | YC connector | Strong |
| GitHub trending repo matching thesis | GitHub connector | Medium |
| npm package creation in thesis category | npm connector | Medium |
| Funding round in thesis space | Crunchbase (BYO) | Strong |
| Continued signal growth (thesis didn't decay) | Internal | Weak |

**Data model:**

```sql
CREATE TABLE thesis_predictions (
  id SERIAL PRIMARY KEY,
  thesis_key TEXT NOT NULL,
  predicted_at TIMESTAMPTZ NOT NULL,
  confidence_at_prediction REAL NOT NULL,
  demand_score REAL,
  timing_score REAL,
  buildability_score REAL,
  virality_score REAL,
  velocity REAL,
  source_categories INTEGER,
  -- Filled in retroactively:
  outcome_checked_at TIMESTAMPTZ,
  outcome_validated BOOLEAN,
  validation_signals JSONB,
  UNIQUE(thesis_key, predicted_at)
);

CREATE TABLE scoring_weight_history (
  id SERIAL PRIMARY KEY,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  demand_weight REAL NOT NULL,
  timing_weight REAL NOT NULL,
  buildability_weight REAL NOT NULL,
  virality_weight REAL NOT NULL,
  velocity_weight REAL NOT NULL,
  precision_score REAL,
  recall_score REAL,
  sample_size INTEGER
);
```

**Prediction snapshot job** (weekly):

```typescript
// For each thesis with confidence > 0.5, create a prediction record
const snapshot = {
  thesis_key: thesis.canonicalKey,
  predicted_at: new Date(),
  confidence_at_prediction: thesis.posteriorConfidence,
  demand_score: thesis.demand,
  timing_score: thesis.timing,
  // ...
};
```

**Validation job** (weekly, checks predictions from 30/60/90 days ago):

```typescript
// For each prediction older than 30 days without outcome_checked_at:
// 1. Search ProductHunt launches for matching keywords
// 2. Search YC companies for matching category
// 3. Search GitHub trending for matching repos
// 4. If any match found: outcome_validated = true
// 5. Update outcome_checked_at
```

**Accuracy metrics:**

```
precision = validated_predictions / total_predictions_checked
recall = validated_predictions / total_actual_launches_in_period
calibration = avg(confidence) for validated predictions vs avg(confidence) for unvalidated
```

**Weight auto-tuning** (Phase 3, but schema designed here):

After accumulating 50+ validated predictions, compute optimal weights via simple grid search:

```
for each weight combination:
  simulate scoring with those weights
  compute precision on historical data
  keep the combination with highest precision
```

Store in `scoring_weight_history` for transparency.

### Files to modify/create

- `apps/api/db/migrations/0017_backtesting.sql` (new)
- `apps/api/src/jobs/backtest_snapshot.ts` (new) — weekly prediction snapshots
- `apps/api/src/jobs/backtest_validate.ts` (new) — retroactive validation
- `apps/api/src/config/env.ts` — backtesting config
- `apps/api/src/main.ts` — schedule weekly backtest jobs

---

## 3. Category Creation Detector

### Problem

The biggest SaaS opportunities aren't incremental improvements — they're new categories. "DevOps" didn't exist, then it did. "Vector databases" went from academic to $1B+ market in 3 years. The current system detects individual signals but not category-level emergence.

### Design

**Three detection signals:**

#### A. Vocabulary Emergence

Track new n-grams appearing across sources that didn't exist 90 days ago:

```typescript
// Extract 2-3 word phrases from signal text
// Compare current 30-day phrase set vs previous 90-day baseline
// Flag phrases that appear 10+ times in current window but 0 times in baseline
```

Examples of what this would have caught:
- "prompt engineering" (2022)
- "vector database" (2023)
- "AI agents" (2024)
- "vibe coding" (2025)

#### B. Tool Fragmentation

Many small projects solving the same problem = category about to form:

```sql
-- Count distinct GitHub repos / npm packages in a topic cluster
-- within the last 30 days
-- If count > 10 and no single dominant player: fragmented
SELECT
  topic,
  COUNT(DISTINCT source_item_id) AS tool_count,
  MAX(engagement_count) AS top_engagement,
  AVG(engagement_count) AS avg_engagement
FROM signal_memory
WHERE source IN ('github_issues', 'producthunt', 'npm_trends')
  AND observed_at > NOW() - INTERVAL '30 days'
GROUP BY topic
HAVING COUNT(DISTINCT source_item_id) > 10
  AND MAX(engagement_count) < 5 * AVG(engagement_count)  -- no dominant player
```

#### C. Investor Attention

Track mentions in VC/startup sources:

```
yc_companies new entries in category
producthunt launches in category
crunchbase funding rounds (BYO)
```

**Category score formula:**

```
category_creation_score =
  vocabulary_emergence_score * 0.3
  + tool_fragmentation_score * 0.4
  + investor_attention_score * 0.3
```

**Integration:** Run as part of the research agent's cluster analysis step. When a cluster has a high category creation score, flag it with a `category_emerging` badge in the UI and boost its thesis confidence.

### Files to modify/create

- `apps/api/src/jobs/category_detector.ts` (new)
- `apps/api/src/jobs/research_agent.ts` — integrate category detection
- `packages/contracts/src/api.ts` — add `categoryEmerging` flag to ThesisListItem

---

## 4. Supply/Demand Imbalance Map

### Problem

A pain signal means nothing if 30 products already solve it. The system currently scores demand but not supply. The most valuable quadrant is high demand + low supply.

### Design

**Supply measurement:**

For each thesis/topic, estimate the number of existing solutions:

```typescript
type SupplyEstimate = {
  existingProducts: number;  // ProductHunt launches, AlternativeTo entries
  githubRepos: number;       // active repos in category
  fundedCompanies: number;   // YC/Crunchbase entries
  maturityLevel: 'nascent' | 'growing' | 'mature' | 'saturated';
};
```

**Data sources for supply:**
- AlternativeTo connector (already exists) — count alternatives in category
- ProductHunt — count recent launches in category
- GitHub — count repos with >100 stars in category
- YC Companies — count YC-backed companies in category

**Imbalance score:**

```
imbalance = demand_signal_count / (existing_products + 1)
```

High imbalance = opportunity. Low imbalance = crowded market.

**Quadrant classification:**

| Demand | Supply | Classification |
|--------|--------|----------------|
| High | Low | Opportunity (boost confidence) |
| High | High | Competitive (neutral) |
| Low | Low | Niche (reduce confidence) |
| Low | High | Saturated (penalize) |

**Integration:** Add as a modifier to thesis scoring:

```typescript
const imbalanceMultiplier = {
  opportunity: 1.5,
  competitive: 1.0,
  niche: 0.7,
  saturated: 0.4,
};
```

### Files to modify/create

- `apps/api/src/jobs/supply_estimator.ts` (new)
- `apps/api/src/jobs/research_agent.ts` — integrate supply/demand analysis
- `packages/contracts/src/api.ts` — add imbalance data to thesis

---

## 5. CUSUM Change Point Detection

### Problem

Gradual trend growth is easy to track. Sudden inflection points — where a topic shifts from stable to explosive — are hard to detect with moving averages.

### Design

Implement CUSUM (Cumulative Sum) for online change point detection:

```typescript
const cusum = (values: number[], threshold: number, drift: number) => {
  let posSum = 0;
  let negSum = 0;
  const changePoints: number[] = [];

  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    posSum = Math.max(0, posSum + diff - drift);
    negSum = Math.max(0, negSum - diff - drift);

    if (posSum > threshold || negSum > threshold) {
      changePoints.push(i);
      posSum = 0;
      negSum = 0;
    }
  }

  return changePoints;
};
```

Apply to daily signal counts per topic. When CUSUM detects a change point, emit a "trend accelerating" event that boosts the velocity multiplier.

**Config:**

```
CUSUM_THRESHOLD=5
CUSUM_DRIFT=1
```

### Files to modify/create

- `apps/api/src/jobs/change_point.ts` (new) — CUSUM implementation (~50 lines)
- `apps/api/src/jobs/research_agent.ts` — integrate change point signals

---

## Success Criteria

1. Adversarial debates produce visibly different (and better) thesis assessments than single-analyst runs
2. Backtesting produces precision/recall metrics after 30+ days of data accumulation
3. Category creation detector flags at least one emerging category per month
4. Supply/demand imbalance correctly identifies crowded vs. open markets
5. CUSUM detects trend inflection points that velocity scoring alone misses
6. All debate transcripts are stored and inspectable
7. All existing tests continue to pass

---

## Risks

| Risk | Mitigation |
|------|------------|
| Adversarial debates triple AI token cost | Only debate top 5 theses per run (configurable) |
| Bear agent too negative (kills all theses) | Tune bear prompt; require specific counter-evidence, not vibes |
| Backtesting needs 30+ days of data | Start snapshotting immediately; results come later |
| Supply estimation is noisy | Use multiple supply sources; require 2+ sources to agree |
| CUSUM false positives on noisy data | Conservative threshold; require corroboration from 2+ sources |
| Category detection catches buzzwords, not real categories | Require tool fragmentation (real projects) not just vocabulary |
