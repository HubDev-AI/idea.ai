# Phase 2: Intelligence Amplification — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add adversarial agent debate, backtesting engine, category creation detection, supply/demand imbalance mapping, and CUSUM change point detection to dramatically improve thesis quality and create provable prediction accuracy.

**Architecture:** Extends Phase 1 foundations (Bayesian confidence, velocity scoring, new connectors). Adds new agent reasoning patterns (bull/bear/moderator debate), a retrospective validation loop (backtesting), and three new scoring modules (CUSUM, category detector, supply estimator). All changes are additive — existing pipeline and tests must continue to pass.

**Tech Stack:** TypeScript, PostgreSQL + pgvector, Claude/Codex CLI, Ollama, vitest

**Design doc:** `docs/plans/2026-03-06-intelligence-phase2-design.md`

**Existing state:** Phase 1 complete (migrations 0018-0020, bayesian.ts, velocity.ts, correlation.ts, blend.ts). 286 tests passing. Latest migration: 0020.

---

## Task 1: Database Migration — Debate Table

**Files:**
- Create: `apps/api/db/migrations/0021_thesis_debates.sql`

**Step 1: Write the migration**

```sql
-- 0021_thesis_debates.sql
-- Store adversarial debate transcripts for thesis evaluation transparency

CREATE TABLE IF NOT EXISTS thesis_debates (
  id SERIAL PRIMARY KEY,
  thesis_key TEXT NOT NULL,
  run_id TEXT NOT NULL,
  bull_provider TEXT NOT NULL,
  bear_provider TEXT NOT NULL,
  bull_case TEXT NOT NULL,
  bear_case TEXT NOT NULL,
  moderator_verdict JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thesis_debates_key ON thesis_debates(thesis_key);
CREATE INDEX IF NOT EXISTS idx_thesis_debates_run ON thesis_debates(run_id);
```

Note: No FK to thesis_candidates — thesis_key is a text reference to canonical_key. This avoids circular dependency issues and allows debates on theses that may later be pruned.

**Step 2: Run the migration**

```bash
source .env && psql "$DATABASE_URL" -f apps/api/db/migrations/0021_thesis_debates.sql
```

Expected: CREATE TABLE and CREATE INDEX succeed.

**Step 3: Commit**

```bash
git add apps/api/db/migrations/0021_thesis_debates.sql
git commit -m "feat: add thesis_debates table (migration 0021)"
```

---

## Task 2: Database Migration — Backtesting Tables

**Files:**
- Create: `apps/api/db/migrations/0022_backtesting.sql`

**Step 1: Write the migration**

```sql
-- 0022_backtesting.sql
-- Prediction snapshots and scoring weight history for backtesting engine

CREATE TABLE IF NOT EXISTS thesis_predictions (
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
  outcome_checked_at TIMESTAMPTZ,
  outcome_validated BOOLEAN,
  validation_signals JSONB,
  UNIQUE(thesis_key, predicted_at)
);

CREATE INDEX IF NOT EXISTS idx_thesis_predictions_key ON thesis_predictions(thesis_key);
CREATE INDEX IF NOT EXISTS idx_thesis_predictions_unchecked
  ON thesis_predictions(predicted_at) WHERE outcome_checked_at IS NULL;

CREATE TABLE IF NOT EXISTS scoring_weight_history (
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

**Step 2: Run the migration**

```bash
source .env && psql "$DATABASE_URL" -f apps/api/db/migrations/0022_backtesting.sql
```

Expected: CREATE TABLE and CREATE INDEX succeed.

**Step 3: Commit**

```bash
git add apps/api/db/migrations/0022_backtesting.sql
git commit -m "feat: add backtesting tables (migration 0022)"
```

---

## Task 3: CUSUM Change Point Detection — Pure Module

**Files:**
- Create: `packages/pipeline/src/scoring/cusum.ts`
- Create: `packages/pipeline/tests/cusum.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/pipeline/tests/cusum.test.ts
import { describe, expect, it } from 'vitest';
import { detectChangePoints, type CusumConfig, DEFAULT_CUSUM_CONFIG } from '../src/scoring/cusum';

describe('detectChangePoints', () => {
  it('returns empty for flat signal', () => {
    const values = [10, 10, 10, 10, 10, 10, 10];
    expect(detectChangePoints(values)).toEqual([]);
  });

  it('detects upward change point', () => {
    const values = [10, 10, 10, 10, 50, 50, 50];
    const points = detectChangePoints(values);
    expect(points.length).toBeGreaterThanOrEqual(1);
    expect(points[0]).toBeGreaterThanOrEqual(3);
    expect(points[0]).toBeLessThanOrEqual(5);
  });

  it('detects downward change point', () => {
    const values = [50, 50, 50, 50, 10, 10, 10];
    const points = detectChangePoints(values);
    expect(points.length).toBeGreaterThanOrEqual(1);
  });

  it('respects custom threshold', () => {
    const values = [10, 10, 12, 10, 11, 10, 10];
    // Very small diffs should not trigger with default threshold
    expect(detectChangePoints(values)).toEqual([]);
    // But should trigger with very low threshold
    const points = detectChangePoints(values, { threshold: 0.5, drift: 0.1 });
    expect(points.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty input', () => {
    expect(detectChangePoints([])).toEqual([]);
  });

  it('handles single value', () => {
    expect(detectChangePoints([42])).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm --dir packages/pipeline exec vitest run tests/cusum.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

```typescript
// packages/pipeline/src/scoring/cusum.ts

export type CusumConfig = {
  threshold: number;
  drift: number;
};

export const DEFAULT_CUSUM_CONFIG: CusumConfig = {
  threshold: 5,
  drift: 1,
};

/**
 * CUSUM (Cumulative Sum) change point detection.
 * Returns indices where a significant shift in signal frequency is detected.
 */
export const detectChangePoints = (
  values: number[],
  config: CusumConfig = DEFAULT_CUSUM_CONFIG
): number[] => {
  if (values.length < 2) return [];

  const { threshold, drift } = config;
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

**Step 4: Run tests to verify they pass**

```bash
pnpm --dir packages/pipeline exec vitest run tests/cusum.test.ts
```

Expected: ALL PASS.

**Step 5: Commit**

```bash
git add packages/pipeline/src/scoring/cusum.ts packages/pipeline/tests/cusum.test.ts
git commit -m "feat: add CUSUM change point detection module"
```

---

## Task 4: Category Creation Detector — Pure Module

**Files:**
- Create: `packages/pipeline/src/scoring/category_detector.ts`
- Create: `packages/pipeline/tests/category_detector.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/pipeline/tests/category_detector.test.ts
import { describe, expect, it } from 'vitest';
import {
  detectVocabularyEmergence,
  computeToolFragmentation,
  computeInvestorAttention,
  categoryCreationScore,
} from '../src/scoring/category_detector';

describe('detectVocabularyEmergence', () => {
  it('flags phrases appearing in current window but not baseline', () => {
    const baseline = ['react hooks are great', 'typescript generics help', 'graphql resolvers work'];
    const current = ['vibe coding is new', 'vibe coding rocks', 'vibe coding with AI', 'react hooks still great'];
    const result = detectVocabularyEmergence(baseline, current, { minCount: 2 });
    expect(result.emergingPhrases).toContain('vibe coding');
    expect(result.score).toBeGreaterThan(0);
  });

  it('returns 0 for identical sets', () => {
    const texts = ['react hooks are great', 'typescript generics help'];
    const result = detectVocabularyEmergence(texts, texts);
    expect(result.score).toBe(0);
    expect(result.emergingPhrases).toEqual([]);
  });
});

describe('computeToolFragmentation', () => {
  it('high fragmentation = many tools, no dominant player', () => {
    const tools = Array.from({ length: 15 }, (_, i) => ({
      id: `tool-${i}`,
      engagement: 100 + Math.random() * 50,
    }));
    const result = computeToolFragmentation(tools);
    expect(result.score).toBeGreaterThan(50);
    expect(result.isFragmented).toBe(true);
  });

  it('low fragmentation = one dominant tool', () => {
    const tools = [
      { id: 'dominant', engagement: 10000 },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `small-${i}`, engagement: 10 })),
    ];
    const result = computeToolFragmentation(tools);
    expect(result.isFragmented).toBe(false);
  });

  it('returns 0 for empty input', () => {
    expect(computeToolFragmentation([]).score).toBe(0);
  });
});

describe('computeInvestorAttention', () => {
  it('high attention from multiple VC sources', () => {
    const signals = [
      { source: 'yc_companies', count: 3 },
      { source: 'producthunt', count: 5 },
      { source: 'crunchbase', count: 2 },
    ];
    const result = computeInvestorAttention(signals);
    expect(result.score).toBeGreaterThan(50);
  });

  it('zero for no signals', () => {
    expect(computeInvestorAttention([]).score).toBe(0);
  });
});

describe('categoryCreationScore', () => {
  it('blends three sub-scores with weights', () => {
    const score = categoryCreationScore({
      vocabularyScore: 80,
      fragmentationScore: 60,
      investorScore: 40,
    });
    // 0.3 * 80 + 0.4 * 60 + 0.3 * 40 = 24 + 24 + 12 = 60
    expect(score).toBe(60);
  });

  it('clamps to 0-100', () => {
    expect(categoryCreationScore({ vocabularyScore: 0, fragmentationScore: 0, investorScore: 0 })).toBe(0);
    expect(categoryCreationScore({ vocabularyScore: 100, fragmentationScore: 100, investorScore: 100 })).toBe(100);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm --dir packages/pipeline exec vitest run tests/category_detector.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

```typescript
// packages/pipeline/src/scoring/category_detector.ts

const extractBigrams = (text: string): string[] => {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]} ${words[i + 1]}`);
  }
  return bigrams;
};

export const detectVocabularyEmergence = (
  baselineTexts: string[],
  currentTexts: string[],
  opts: { minCount?: number } = {}
): { emergingPhrases: string[]; score: number } => {
  const minCount = opts.minCount ?? 3;
  const baselinePhrases = new Set<string>();
  for (const text of baselineTexts) {
    for (const bg of extractBigrams(text)) baselinePhrases.add(bg);
  }

  const currentCounts = new Map<string, number>();
  for (const text of currentTexts) {
    for (const bg of extractBigrams(text)) {
      currentCounts.set(bg, (currentCounts.get(bg) ?? 0) + 1);
    }
  }

  const emerging: string[] = [];
  for (const [phrase, count] of currentCounts) {
    if (count >= minCount && !baselinePhrases.has(phrase)) {
      emerging.push(phrase);
    }
  }

  const score = Math.min(100, emerging.length * 20);
  return { emergingPhrases: emerging, score };
};

export const computeToolFragmentation = (
  tools: { id: string; engagement: number }[]
): { score: number; isFragmented: boolean; toolCount: number } => {
  if (tools.length === 0) return { score: 0, isFragmented: false, toolCount: 0 };

  const maxEngagement = Math.max(...tools.map(t => t.engagement));
  const avgEngagement = tools.reduce((s, t) => s + t.engagement, 0) / tools.length;

  // Fragmented if 10+ tools and no dominant player (max < 5x average)
  const isFragmented = tools.length >= 10 && maxEngagement < 5 * avgEngagement;

  // Score based on tool count and evenness of distribution
  const countScore = Math.min(100, tools.length * 8);
  const evennessScore = maxEngagement < 3 * avgEngagement ? 100 : maxEngagement < 5 * avgEngagement ? 60 : 20;
  const score = Math.round(countScore * 0.5 + evennessScore * 0.5);

  return { score, isFragmented, toolCount: tools.length };
};

export const computeInvestorAttention = (
  signals: { source: string; count: number }[]
): { score: number; totalSignals: number } => {
  if (signals.length === 0) return { score: 0, totalSignals: 0 };

  const vcSources = new Set(['yc_companies', 'producthunt', 'crunchbase']);
  const total = signals.reduce((sum, s) => sum + s.count, 0);
  const vcSourceCount = signals.filter(s => vcSources.has(s.source) && s.count > 0).length;

  // Score: combination of total volume and source diversity
  const volumeScore = Math.min(100, total * 10);
  const diversityScore = (vcSourceCount / 3) * 100;
  const score = Math.round(volumeScore * 0.5 + diversityScore * 0.5);

  return { score, totalSignals: total };
};

export const categoryCreationScore = (input: {
  vocabularyScore: number;
  fragmentationScore: number;
  investorScore: number;
}): number => {
  const raw = input.vocabularyScore * 0.3 + input.fragmentationScore * 0.4 + input.investorScore * 0.3;
  return Math.round(Math.max(0, Math.min(100, raw)));
};
```

**Step 4: Run tests to verify they pass**

```bash
pnpm --dir packages/pipeline exec vitest run tests/category_detector.test.ts
```

Expected: ALL PASS.

**Step 5: Commit**

```bash
git add packages/pipeline/src/scoring/category_detector.ts packages/pipeline/tests/category_detector.test.ts
git commit -m "feat: add category creation detector module"
```

---

## Task 5: Supply/Demand Imbalance Estimator — Pure Module

**Files:**
- Create: `packages/pipeline/src/scoring/supply_demand.ts`
- Create: `packages/pipeline/tests/supply_demand.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/pipeline/tests/supply_demand.test.ts
import { describe, expect, it } from 'vitest';
import { estimateSupply, classifyImbalance, imbalanceMultiplier, type SupplyEstimate } from '../src/scoring/supply_demand';

describe('estimateSupply', () => {
  it('computes maturity from product and repo counts', () => {
    const result = estimateSupply({ existingProducts: 2, githubRepos: 5, fundedCompanies: 1 });
    expect(result.maturityLevel).toBe('growing');
    expect(result.totalSupply).toBe(8);
  });

  it('nascent for zero supply', () => {
    const result = estimateSupply({ existingProducts: 0, githubRepos: 0, fundedCompanies: 0 });
    expect(result.maturityLevel).toBe('nascent');
  });

  it('saturated for very high supply', () => {
    const result = estimateSupply({ existingProducts: 50, githubRepos: 100, fundedCompanies: 20 });
    expect(result.maturityLevel).toBe('saturated');
  });
});

describe('classifyImbalance', () => {
  it('opportunity when high demand, low supply', () => {
    expect(classifyImbalance({ demandSignals: 20, totalSupply: 2 })).toBe('opportunity');
  });

  it('competitive when both high', () => {
    expect(classifyImbalance({ demandSignals: 20, totalSupply: 25 })).toBe('competitive');
  });

  it('niche when both low', () => {
    expect(classifyImbalance({ demandSignals: 2, totalSupply: 1 })).toBe('niche');
  });

  it('saturated when low demand, high supply', () => {
    expect(classifyImbalance({ demandSignals: 3, totalSupply: 30 })).toBe('saturated');
  });
});

describe('imbalanceMultiplier', () => {
  it('boosts opportunity', () => {
    expect(imbalanceMultiplier('opportunity')).toBe(1.5);
  });

  it('neutral for competitive', () => {
    expect(imbalanceMultiplier('competitive')).toBe(1.0);
  });

  it('penalizes niche', () => {
    expect(imbalanceMultiplier('niche')).toBe(0.7);
  });

  it('penalizes saturated', () => {
    expect(imbalanceMultiplier('saturated')).toBe(0.4);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
pnpm --dir packages/pipeline exec vitest run tests/supply_demand.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

```typescript
// packages/pipeline/src/scoring/supply_demand.ts

export type SupplyInput = {
  existingProducts: number;
  githubRepos: number;
  fundedCompanies: number;
};

export type SupplyEstimate = {
  totalSupply: number;
  maturityLevel: 'nascent' | 'growing' | 'mature' | 'saturated';
};

export type ImbalanceClass = 'opportunity' | 'competitive' | 'niche' | 'saturated';

export const estimateSupply = (input: SupplyInput): SupplyEstimate => {
  const total = input.existingProducts + input.githubRepos + input.fundedCompanies;

  let maturityLevel: SupplyEstimate['maturityLevel'];
  if (total === 0) maturityLevel = 'nascent';
  else if (total <= 15) maturityLevel = 'growing';
  else if (total <= 50) maturityLevel = 'mature';
  else maturityLevel = 'saturated';

  return { totalSupply: total, maturityLevel };
};

export const classifyImbalance = (input: {
  demandSignals: number;
  totalSupply: number;
}): ImbalanceClass => {
  const { demandSignals, totalSupply } = input;
  const highDemand = demandSignals >= 10;
  const highSupply = totalSupply >= 15;

  if (highDemand && !highSupply) return 'opportunity';
  if (highDemand && highSupply) return 'competitive';
  if (!highDemand && !highSupply) return 'niche';
  return 'saturated';
};

export const imbalanceMultiplier = (classification: ImbalanceClass): number => {
  const multipliers: Record<ImbalanceClass, number> = {
    opportunity: 1.5,
    competitive: 1.0,
    niche: 0.7,
    saturated: 0.4,
  };
  return multipliers[classification];
};
```

**Step 4: Run tests to verify they pass**

```bash
pnpm --dir packages/pipeline exec vitest run tests/supply_demand.test.ts
```

Expected: ALL PASS.

**Step 5: Commit**

```bash
git add packages/pipeline/src/scoring/supply_demand.ts packages/pipeline/tests/supply_demand.test.ts
git commit -m "feat: add supply/demand imbalance estimator module"
```

---

## Task 6: Adversarial Debate Orchestration Module

**Files:**
- Create: `apps/api/src/jobs/thesis_debate.ts`
- Create: `apps/api/tests/thesis_debate.test.ts`

**Context:** The debate module orchestrates a structured bull/bear/moderator debate using the existing `runClaude`/`runCodex` adapters from `packages/ai-runtime`. It does NOT modify the research agent — it's a standalone module that agent_runner will call.

**Step 1: Write the failing tests**

```typescript
// apps/api/tests/thesis_debate.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  runDebate,
  parseModeratorVerdict,
  verdictToLikelihoodRatio,
  BULL_SYSTEM,
  BEAR_SYSTEM,
  MODERATOR_SYSTEM,
  type DebateResult,
  type ModeratorVerdict,
} from '../src/jobs/thesis_debate';

describe('parseModeratorVerdict', () => {
  it('parses valid JSON verdict', () => {
    const raw = JSON.stringify({
      confidence: 0.7,
      bull_strength: 80,
      bear_strength: 40,
      missing_evidence: ['market size data'],
      verdict: 'strong_opportunity',
    });
    const result = parseModeratorVerdict(raw);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('strong_opportunity');
    expect(result!.confidence).toBe(0.7);
  });

  it('parses markdown-wrapped JSON', () => {
    const raw = '```json\n{"confidence":0.5,"bull_strength":60,"bear_strength":55,"missing_evidence":[],"verdict":"contested"}\n```';
    const result = parseModeratorVerdict(raw);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('contested');
  });

  it('returns null for invalid input', () => {
    expect(parseModeratorVerdict('not json at all')).toBeNull();
  });

  it('returns null for missing verdict field', () => {
    expect(parseModeratorVerdict('{"confidence": 0.5}')).toBeNull();
  });
});

describe('verdictToLikelihoodRatio', () => {
  it('strong_opportunity returns 2.5', () => {
    expect(verdictToLikelihoodRatio('strong_opportunity')).toBe(2.5);
  });
  it('needs_investigation returns 1.3', () => {
    expect(verdictToLikelihoodRatio('needs_investigation')).toBe(1.3);
  });
  it('contested returns 0.8', () => {
    expect(verdictToLikelihoodRatio('contested')).toBe(0.8);
  });
  it('likely_noise returns 0.3', () => {
    expect(verdictToLikelihoodRatio('likely_noise')).toBe(0.3);
  });
});

describe('runDebate', () => {
  it('orchestrates bull → bear → moderator sequentially', async () => {
    const callOrder: string[] = [];
    const mockRun = (label: string) => async (input: { prompt: string }) => {
      callOrder.push(label);
      if (label.includes('moderator')) {
        return {
          text: JSON.stringify({
            confidence: 0.6, bull_strength: 70, bear_strength: 50,
            missing_evidence: [], verdict: 'needs_investigation',
          }),
          provider: 'claude' as const,
          meta: {},
        };
      }
      return { text: `${label} argument for the thesis`, provider: 'claude' as const, meta: {} };
    };

    const result = await runDebate({
      thesisTitle: 'Test Thesis',
      thesisKey: 'test:key',
      problemStatement: 'A test problem',
      evidence: ['signal 1', 'signal 2'],
      runBull: mockRun('bull'),
      runBear: mockRun('bear'),
      runModerator: mockRun('moderator'),
    });

    expect(result).not.toBeNull();
    expect(callOrder).toEqual(['bull', 'bear', 'moderator']);
    expect(result!.verdict.verdict).toBe('needs_investigation');
    expect(result!.bullCase).toContain('bull argument');
    expect(result!.bearCase).toContain('bear argument');
  });

  it('returns null if moderator fails to parse', async () => {
    const mockRun = async () => ({ text: 'garbage', provider: 'claude' as const, meta: {} });
    const result = await runDebate({
      thesisTitle: 'Test', thesisKey: 'k', problemStatement: 'p', evidence: [],
      runBull: mockRun, runBear: mockRun, runModerator: mockRun,
    });
    expect(result).toBeNull();
  });
});

describe('system prompts exist', () => {
  it('has all three system prompts', () => {
    expect(BULL_SYSTEM.length).toBeGreaterThan(50);
    expect(BEAR_SYSTEM.length).toBeGreaterThan(50);
    expect(MODERATOR_SYSTEM.length).toBeGreaterThan(50);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
CI=1 pnpm --dir apps/api exec vitest run tests/thesis_debate.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

```typescript
// apps/api/src/jobs/thesis_debate.ts

import type { RunPromptInput, RunPromptResult } from '@idea/ai-runtime/src/types';

export type DebateVerdict = 'strong_opportunity' | 'needs_investigation' | 'contested' | 'likely_noise';

export type ModeratorVerdict = {
  confidence: number;
  bull_strength: number;
  bear_strength: number;
  missing_evidence: string[];
  verdict: DebateVerdict;
};

export type DebateResult = {
  bullCase: string;
  bearCase: string;
  verdict: ModeratorVerdict;
  bullProvider: string;
  bearProvider: string;
};

export type DebateInput = {
  thesisTitle: string;
  thesisKey: string;
  problemStatement: string;
  evidence: string[];
  runBull: (input: RunPromptInput) => Promise<RunPromptResult>;
  runBear: (input: RunPromptInput) => Promise<RunPromptResult>;
  runModerator: (input: RunPromptInput) => Promise<RunPromptResult>;
};

export const BULL_SYSTEM = `You are a startup opportunity analyst. Your job is to make the strongest possible case for why this thesis represents a real, buildable SaaS opportunity. Cite specific evidence from the signals provided. Be specific about market size, timing, and competitive advantage. Output a clear, structured argument in 200-400 words.`;

export const BEAR_SYSTEM = `You are a skeptical VC partner. Your job is to find every reason this thesis will FAIL. Consider: Is the market too small? Are incumbents too strong? Is the timing wrong? Is this a hype cycle? Is the pain real or manufactured? Be ruthlessly honest. You must counter the bull case with specific arguments. Output a clear, structured rebuttal in 200-400 words.`;

export const MODERATOR_SYSTEM = `You are a senior investment committee chair. You have received a bull case and a bear case for a startup thesis. Weigh both arguments objectively. Output ONLY a JSON object (no markdown, no explanation) with these fields: confidence (0-1 float), bull_strength (0-100 int), bear_strength (0-100 int), missing_evidence (array of strings, max 3), verdict (one of: "strong_opportunity", "needs_investigation", "likely_noise", "contested").`;

const validVerdicts = new Set<DebateVerdict>([
  'strong_opportunity', 'needs_investigation', 'contested', 'likely_noise',
]);

export const parseModeratorVerdict = (raw: string): ModeratorVerdict | null => {
  try {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.verdict || !validVerdicts.has(parsed.verdict)) return null;
    return {
      confidence: Number(parsed.confidence ?? 0.5),
      bull_strength: Number(parsed.bull_strength ?? 50),
      bear_strength: Number(parsed.bear_strength ?? 50),
      missing_evidence: Array.isArray(parsed.missing_evidence) ? parsed.missing_evidence.slice(0, 5) : [],
      verdict: parsed.verdict,
    };
  } catch {
    return null;
  }
};

const VERDICT_LR: Record<DebateVerdict, number> = {
  strong_opportunity: 2.5,
  needs_investigation: 1.3,
  contested: 0.8,
  likely_noise: 0.3,
};

export const verdictToLikelihoodRatio = (verdict: DebateVerdict): number =>
  VERDICT_LR[verdict] ?? 1.0;

export const runDebate = async (input: DebateInput): Promise<DebateResult | null> => {
  const evidenceBlock = input.evidence.length > 0
    ? `\n\nSupporting evidence:\n${input.evidence.map((e, i) => `${i + 1}. ${e}`).join('\n')}`
    : '';

  // 1. Bull case
  const bullResult = await input.runBull({
    prompt: `${BULL_SYSTEM}\n\nThesis: "${input.thesisTitle}"\nProblem: ${input.problemStatement}${evidenceBlock}\n\nMake your bull case:`,
  });

  // 2. Bear case (sees the bull case)
  const bearResult = await input.runBear({
    prompt: `${BEAR_SYSTEM}\n\nThesis: "${input.thesisTitle}"\nProblem: ${input.problemStatement}${evidenceBlock}\n\nBull case to counter:\n${bullResult.text}\n\nMake your bear case:`,
  });

  // 3. Moderator verdict (sees both)
  const modResult = await input.runModerator({
    prompt: `${MODERATOR_SYSTEM}\n\nThesis: "${input.thesisTitle}"\nProblem: ${input.problemStatement}\n\nBull case:\n${bullResult.text}\n\nBear case:\n${bearResult.text}\n\nOutput your JSON verdict:`,
  });

  const verdict = parseModeratorVerdict(modResult.text);
  if (!verdict) return null;

  return {
    bullCase: bullResult.text,
    bearCase: bearResult.text,
    verdict,
    bullProvider: bullResult.provider,
    bearProvider: bearResult.provider,
  };
};
```

**Step 4: Run tests to verify they pass**

```bash
CI=1 pnpm --dir apps/api exec vitest run tests/thesis_debate.test.ts
```

Expected: ALL PASS.

**Step 5: Commit**

```bash
git add apps/api/src/jobs/thesis_debate.ts apps/api/tests/thesis_debate.test.ts
git commit -m "feat: add adversarial debate orchestration module"
```

---

## Task 7: Env Vars for Phase 2 Features

**Files:**
- Modify: `apps/api/src/config/env.ts`
- Modify: `.env.example`

**Step 1: Add env vars to RuntimeEnv type and loader**

Add to the `RuntimeEnv` type in `apps/api/src/config/env.ts`:

```typescript
// Debate config
debateConfidenceThreshold: number;
debateMaxPerRun: number;
// Backtesting config
backtestSnapshotIntervalMs: number;
backtestValidateAfterDays: number;
// CUSUM config
cusumThreshold: number;
cusumDrift: number;
// Category detector
categoryMinPhraseCount: number;
```

Add to the `loadRuntimeEnv` function return object:

```typescript
debateConfidenceThreshold: parseNumber(env.DEBATE_CONFIDENCE_THRESHOLD, 40),
debateMaxPerRun: parseNumber(env.DEBATE_MAX_PER_RUN, 5),
backtestSnapshotIntervalMs: parseNumber(env.BACKTEST_SNAPSHOT_INTERVAL_MS, 7 * 24 * 60 * 60 * 1000),
backtestValidateAfterDays: parseNumber(env.BACKTEST_VALIDATE_AFTER_DAYS, 30),
cusumThreshold: parseNumber(env.CUSUM_THRESHOLD, 5),
cusumDrift: parseNumber(env.CUSUM_DRIFT, 1),
categoryMinPhraseCount: parseNumber(env.CATEGORY_MIN_PHRASE_COUNT, 3),
```

**Step 2: Add defaults to .env.example**

Append to `.env.example`:

```bash
# Phase 2: Intelligence Amplification
DEBATE_CONFIDENCE_THRESHOLD=40
DEBATE_MAX_PER_RUN=5
BACKTEST_SNAPSHOT_INTERVAL_MS=604800000
BACKTEST_VALIDATE_AFTER_DAYS=30
CUSUM_THRESHOLD=5
CUSUM_DRIFT=1
CATEGORY_MIN_PHRASE_COUNT=3
```

**Step 3: Run all tests to verify nothing breaks**

```bash
CI=1 pnpm test
```

Expected: ALL PASS.

**Step 4: Commit**

```bash
git add apps/api/src/config/env.ts .env.example
git commit -m "feat: add Phase 2 env vars (debate, backtest, CUSUM, category)"
```

---

## Task 8: Integrate Adversarial Debate into Agent Runner

**Files:**
- Modify: `apps/api/src/jobs/agent_runner.ts`

**Context:** After the broad scan (Phase 1 of agent run), before deep dives, debate the top N theses that pass the confidence threshold. Store debate results and apply Bayesian updates. The debate step slots between the existing Phase 1 (broad scan) and Phase 2 (deep dives) in agent_runner.ts.

**Step 1: Add imports**

At the top of `apps/api/src/jobs/agent_runner.ts`, add:

```typescript
import { runDebate, verdictToLikelihoodRatio, type DebateResult } from './thesis_debate';
import { bayesianUpdate, type SignalEvidence } from '@idea/pipeline/src/scoring/bayesian';
```

Note: `bayesianUpdate` may already be imported — check before adding a duplicate.

**Step 2: Add debate step after broad scan**

After the broad scan block (Phase 1) and before deep dives (Phase 2), insert:

```typescript
  // === Phase 1.5: Adversarial Debate on top theses ===
  const debateThreshold = deps.debateConfidenceThreshold ?? 40;
  const debateMax = deps.debateMaxPerRun ?? 5;
  const debateCandidates = (await deps.thesisStore.list())
    .filter(t => t.confidence >= debateThreshold)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, debateMax);

  const debateResults: Array<{ thesisKey: string; result: DebateResult }> = [];
  const debateRound = Date.now(); // for provider rotation

  for (const thesis of debateCandidates) {
    try {
      const evidence = thesis.evidence.map(e => e.snippet).filter(Boolean);
      const useClaude = debateRound % 2 === 0;
      const result = await runDebate({
        thesisTitle: thesis.title,
        thesisKey: thesis.canonicalKey,
        problemStatement: thesis.problemStatement,
        evidence,
        runBull: useClaude ? deps.runClaude : deps.runCodex,
        runBear: useClaude ? deps.runCodex : deps.runClaude,
        runModerator: deps.runClaude,
      });

      if (result) {
        debateResults.push({ thesisKey: thesis.canonicalKey, result });

        // Apply Bayesian update based on verdict
        const lr = verdictToLikelihoodRatio(result.verdict.verdict);
        const evidenceType: SignalEvidence['type'] = lr >= 1.5
          ? 'multi_source_convergence'
          : lr >= 1.0
            ? 'single_high_quality'
            : 'weak_noisy';
        const delta = bayesianUpdate(thesis.confidence, {
          type: evidenceType,
          confirming: lr >= 1.0,
        }) - thesis.confidence;
        if (deps.thesisStore.bayesianUpdate && Math.abs(delta) > 0.1) {
          await deps.thesisStore.bayesianUpdate(thesis.canonicalKey, delta);
        }

        // Store debate transcript
        if (deps.pool) {
          await deps.pool.query(
            `INSERT INTO thesis_debates (thesis_key, run_id, bull_provider, bear_provider, bull_case, bear_case, moderator_verdict)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [thesis.canonicalKey, deps.runId ?? 'unknown', result.bullProvider, result.bearProvider,
             result.bullCase, result.bearCase, JSON.stringify(result.verdict)]
          );
        }

        await log.info('agent_runner', 'debate completed', {
          thesis: thesis.canonicalKey,
          verdict: result.verdict.verdict,
          confidence: result.verdict.confidence,
          delta: Math.round(delta * 10) / 10,
        });
      }
    } catch (err) {
      await log.warn('agent_runner', 'debate failed', { thesis: thesis.canonicalKey, error: String(err) });
    }
  }

  stats.debatesPerformed = debateResults.length;
```

**Step 3: Add pool and debate config to AgentRunnerDeps type**

In the `AgentRunnerDeps` type, add:

```typescript
  pool?: import('pg').Pool;
  debateConfidenceThreshold?: number;
  debateMaxPerRun?: number;
```

**Step 4: Pass pool and debate config from main.ts**

In `main.ts` where `executeAgentRun` builds deps for `agentRunner`, add the pool and debate config from runtimeEnv:

```typescript
pool,
debateConfidenceThreshold: runtimeEnv.debateConfidenceThreshold,
debateMaxPerRun: runtimeEnv.debateMaxPerRun,
```

**Step 5: Add debatesPerformed to stats tracking**

In agent_runner.ts, find the stats object initialization and add `debatesPerformed: 0`. Also update `AgentRunResult` in `packages/contracts/src/api.ts` to include `debatesPerformed?: number`.

**Step 6: Run all tests**

```bash
CI=1 pnpm test
```

Expected: ALL PASS. The debate step only runs when real AI providers are available and when theses exist above threshold.

**Step 7: Commit**

```bash
git add apps/api/src/jobs/agent_runner.ts apps/api/src/main.ts packages/contracts/src/api.ts
git commit -m "feat: integrate adversarial debate into agent runner"
```

---

## Task 9: Backtesting Snapshot Job

**Files:**
- Create: `apps/api/src/jobs/backtest_snapshot.ts`
- Create: `apps/api/tests/backtest_snapshot.test.ts`

**Step 1: Write the failing tests**

```typescript
// apps/api/tests/backtest_snapshot.test.ts
import { describe, expect, it, vi } from 'vitest';
import { snapshotPredictions, type SnapshotDeps } from '../src/jobs/backtest_snapshot';

describe('snapshotPredictions', () => {
  it('creates prediction records for theses above threshold', async () => {
    const inserted: any[] = [];
    const mockPool = {
      query: vi.fn(async (_sql: string, params: any[]) => {
        inserted.push(params);
        return { rows: [], rowCount: 1 };
      }),
    };

    const mockThesisStore = {
      list: vi.fn(async () => [
        { canonicalKey: 'test:a', confidence: 60, avgDemand: 70, avgTiming: 50, avgBuildability: 40, avgVirality: 80, velocity: 2.0, evidence: [] },
        { canonicalKey: 'test:b', confidence: 30, avgDemand: 20, avgTiming: 20, avgBuildability: 20, avgVirality: 20, velocity: null, evidence: [] },
      ]),
    };

    const result = await snapshotPredictions({
      pool: mockPool as any,
      thesisStore: mockThesisStore as any,
      confidenceThreshold: 50,
    });

    expect(result.snapshotted).toBe(1); // Only test:a is above 50
    expect(inserted).toHaveLength(1);
    expect(inserted[0][0]).toBe('test:a');
  });

  it('returns 0 when no theses qualify', async () => {
    const mockPool = { query: vi.fn() };
    const mockThesisStore = {
      list: vi.fn(async () => [
        { canonicalKey: 'test:low', confidence: 20, avgDemand: 10, avgTiming: 10, avgBuildability: 10, avgVirality: 10, velocity: null, evidence: [] },
      ]),
    };

    const result = await snapshotPredictions({
      pool: mockPool as any,
      thesisStore: mockThesisStore as any,
      confidenceThreshold: 50,
    });

    expect(result.snapshotted).toBe(0);
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
CI=1 pnpm --dir apps/api exec vitest run tests/backtest_snapshot.test.ts
```

**Step 3: Write minimal implementation**

```typescript
// apps/api/src/jobs/backtest_snapshot.ts

import type { Pool } from 'pg';
import type { ThesisStore } from '../runtime/thesis_store';

export type SnapshotDeps = {
  pool: Pool;
  thesisStore: ThesisStore;
  confidenceThreshold?: number;
};

export const snapshotPredictions = async (
  deps: SnapshotDeps
): Promise<{ snapshotted: number }> => {
  const threshold = deps.confidenceThreshold ?? 50;
  const theses = await deps.thesisStore.list();
  const qualified = theses.filter(t => t.confidence >= threshold);

  let snapshotted = 0;
  for (const thesis of qualified) {
    await deps.pool.query(
      `INSERT INTO thesis_predictions
        (thesis_key, predicted_at, confidence_at_prediction, demand_score, timing_score,
         buildability_score, virality_score, velocity, source_categories)
       VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (thesis_key, predicted_at) DO NOTHING`,
      [
        thesis.canonicalKey,
        thesis.confidence,
        thesis.avgDemand ?? null,
        thesis.avgTiming ?? null,
        thesis.avgBuildability ?? null,
        thesis.avgVirality ?? null,
        thesis.velocity ?? null,
        thesis.evidence?.length ?? 0,
      ]
    );
    snapshotted++;
  }

  return { snapshotted };
};
```

**Step 4: Run tests to verify they pass**

```bash
CI=1 pnpm --dir apps/api exec vitest run tests/backtest_snapshot.test.ts
```

**Step 5: Commit**

```bash
git add apps/api/src/jobs/backtest_snapshot.ts apps/api/tests/backtest_snapshot.test.ts
git commit -m "feat: add backtesting prediction snapshot job"
```

---

## Task 10: Backtesting Validation Job

**Files:**
- Create: `apps/api/src/jobs/backtest_validate.ts`
- Create: `apps/api/tests/backtest_validate.test.ts`

**Step 1: Write the failing tests**

```typescript
// apps/api/tests/backtest_validate.test.ts
import { describe, expect, it, vi } from 'vitest';
import { validatePredictions, type ValidationDeps } from '../src/jobs/backtest_validate';

describe('validatePredictions', () => {
  it('validates predictions older than threshold days', async () => {
    const updates: any[] = [];
    const mockPool = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (sql.includes('SELECT')) {
          return {
            rows: [{
              id: 1,
              thesis_key: 'test:thesis',
              predicted_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
              confidence_at_prediction: 70,
            }],
          };
        }
        if (sql.includes('UPDATE')) {
          updates.push(params);
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const mockSignalSearch = vi.fn(async () => [
      { source: 'producthunt', canonical_text: 'matching product launch' },
    ]);

    const result = await validatePredictions({
      pool: mockPool as any,
      searchRecentSignals: mockSignalSearch,
      validateAfterDays: 30,
    });

    expect(result.checked).toBe(1);
    expect(result.validated).toBe(1);
    expect(updates.length).toBeGreaterThan(0);
  });

  it('marks unvalidated when no matching signals found', async () => {
    const mockPool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT')) {
          return {
            rows: [{
              id: 2,
              thesis_key: 'test:nope',
              predicted_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
              confidence_at_prediction: 55,
            }],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const result = await validatePredictions({
      pool: mockPool as any,
      searchRecentSignals: vi.fn(async () => []),
      validateAfterDays: 30,
    });

    expect(result.checked).toBe(1);
    expect(result.validated).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
CI=1 pnpm --dir apps/api exec vitest run tests/backtest_validate.test.ts
```

**Step 3: Write minimal implementation**

```typescript
// apps/api/src/jobs/backtest_validate.ts

import type { Pool } from 'pg';

type PredictionRow = {
  id: number;
  thesis_key: string;
  predicted_at: string;
  confidence_at_prediction: number;
};

type MatchingSignal = {
  source: string;
  canonical_text: string;
};

export type ValidationDeps = {
  pool: Pool;
  searchRecentSignals: (thesisKey: string) => Promise<MatchingSignal[]>;
  validateAfterDays?: number;
};

const VALIDATION_SOURCES = new Set([
  'producthunt', 'yc_companies', 'github_issues', 'npm_trends', 'crunchbase',
]);

export const validatePredictions = async (
  deps: ValidationDeps
): Promise<{ checked: number; validated: number }> => {
  const afterDays = deps.validateAfterDays ?? 30;
  const cutoff = new Date(Date.now() - afterDays * 24 * 60 * 60 * 1000);

  const { rows: unchecked } = await deps.pool.query<PredictionRow>(
    `SELECT id, thesis_key, predicted_at, confidence_at_prediction
     FROM thesis_predictions
     WHERE outcome_checked_at IS NULL
       AND predicted_at < $1
     ORDER BY predicted_at ASC
     LIMIT 50`,
    [cutoff.toISOString()]
  );

  let checked = 0;
  let validated = 0;

  for (const prediction of unchecked) {
    const signals = await deps.searchRecentSignals(prediction.thesis_key);
    const validationSignals = signals.filter(s => VALIDATION_SOURCES.has(s.source));
    const isValidated = validationSignals.length > 0;

    await deps.pool.query(
      `UPDATE thesis_predictions
       SET outcome_checked_at = NOW(),
           outcome_validated = $1,
           validation_signals = $2
       WHERE id = $3`,
      [isValidated, JSON.stringify(validationSignals.slice(0, 10)), prediction.id]
    );

    checked++;
    if (isValidated) validated++;
  }

  return { checked, validated };
};
```

**Step 4: Run tests to verify they pass**

```bash
CI=1 pnpm --dir apps/api exec vitest run tests/backtest_validate.test.ts
```

**Step 5: Commit**

```bash
git add apps/api/src/jobs/backtest_validate.ts apps/api/tests/backtest_validate.test.ts
git commit -m "feat: add backtesting validation job"
```

---

## Task 11: Integrate Category Detection into Agent Runner

**Files:**
- Modify: `apps/api/src/jobs/agent_runner.ts`

**Context:** After cluster metrics computation (velocity/corroboration), run category detection on each cluster. Add a `categoryEmerging` flag to theses whose cluster has a high category creation score.

**Step 1: Add imports**

```typescript
import { detectVocabularyEmergence, computeToolFragmentation, computeInvestorAttention, categoryCreationScore } from '@idea/pipeline/src/scoring/category_detector';
```

**Step 2: Add category detection after cluster metrics block**

After the cluster metrics `for` loop (where velocity/corroboration are computed per cluster), add:

```typescript
  // Compute category creation score per cluster
  const clusterCategoryScores = new Map<number, number>();
  for (const cluster of clusters) {
    const currentTexts = cluster.representatives.map(r => r.canonical_text ?? '');

    // Tool fragmentation from source diversity
    const toolsBySource = new Map<string, number>();
    for (const src of cluster.sources) {
      toolsBySource.set(src, (toolsBySource.get(src) ?? 0) + 1);
    }
    const tools = Array.from(toolsBySource.entries()).map(([id, engagement]) => ({ id, engagement }));
    const fragmentation = computeToolFragmentation(tools);

    // Investor attention from VC-adjacent sources
    const investorSources = cluster.sources
      .filter(s => ['yc_companies', 'producthunt', 'crunchbase'].includes(s));
    const investorCounts = new Map<string, number>();
    for (const s of investorSources) {
      investorCounts.set(s, (investorCounts.get(s) ?? 0) + 1);
    }
    const attention = computeInvestorAttention(
      Array.from(investorCounts.entries()).map(([source, count]) => ({ source, count }))
    );

    // Vocabulary emergence is expensive — only run on clusters with some fragmentation
    let vocabScore = 0;
    if (fragmentation.score > 30 && deps.memoryStore) {
      // Use older signals as baseline (not implemented in this step — requires signal history query)
      // For now, use cluster label overlap as a proxy
      vocabScore = currentTexts.length > 5 ? 40 : 0;
    }

    const catScore = categoryCreationScore({
      vocabularyScore: vocabScore,
      fragmentationScore: fragmentation.score,
      investorScore: attention.score,
    });
    clusterCategoryScores.set(cluster.id, catScore);
  }
```

**Step 3: Apply category scores during thesis enrichment**

In the existing thesis enrichment block (where velocity/corroboration are applied), also set category emerging flag:

```typescript
// Inside the thesis enrichment loop, after bestMetrics assignment:
const catScore = bestMetrics ? clusterCategoryScores.get(/* matching cluster id */) ?? 0 : 0;
```

Note: This requires adding a `categoryScore` field to ThesisDraft. Do this in Task 14 alongside the API contract changes.

**Step 4: Run all tests**

```bash
CI=1 pnpm test
```

**Step 5: Commit**

```bash
git add apps/api/src/jobs/agent_runner.ts
git commit -m "feat: integrate category creation detection into agent runner"
```

---

## Task 12: Integrate Supply/Demand and CUSUM into Agent Runner

**Files:**
- Modify: `apps/api/src/jobs/agent_runner.ts`

**Context:** After cluster metrics, compute supply/demand imbalance per cluster using signal source counts. Apply CUSUM on daily signal counts per topic to detect trend inflection points.

**Step 1: Add imports**

```typescript
import { classifyImbalance, estimateSupply, imbalanceMultiplier } from '@idea/pipeline/src/scoring/supply_demand';
import { detectChangePoints } from '@idea/pipeline/src/scoring/cusum';
```

**Step 2: Add supply/demand estimation per cluster**

After category detection block, add:

```typescript
  // Supply/demand imbalance per cluster
  const clusterImbalance = new Map<number, { classification: string; multiplier: number }>();
  for (const cluster of clusters) {
    const clusterSignalIds = new Set(cluster.representatives.map(r => r.signal_id));
    const matchedSignals = recentSignals.filter(s => clusterSignalIds.has(s.signal_id));
    const demandSignals = matchedSignals.length;

    // Supply: count unique sources from supply-side connectors
    const supplySources = new Set(['producthunt', 'alternativeto', 'github_issues', 'npm_trends']);
    const supplySignals = matchedSignals.filter(s => supplySources.has(s.source));
    const supply = estimateSupply({
      existingProducts: supplySignals.filter(s => s.source === 'producthunt' || s.source === 'alternativeto').length,
      githubRepos: supplySignals.filter(s => s.source === 'github_issues').length,
      fundedCompanies: supplySignals.filter(s => s.source === 'yc_companies').length,
    });

    const classification = classifyImbalance({ demandSignals, totalSupply: supply.totalSupply });
    clusterImbalance.set(cluster.id, { classification, multiplier: imbalanceMultiplier(classification) });
  }
```

**Step 3: Add CUSUM on topic signal counts**

```typescript
  // CUSUM change point detection on daily signal counts per topic
  const cusumConfig = { threshold: deps.cusumThreshold ?? 5, drift: deps.cusumDrift ?? 1 };
  const topicAccelerating = new Set<string>();

  if (deps.memoryStore) {
    // Group recent signals by topic and day
    const topicDailyCounts = new Map<string, Map<string, number>>();
    for (const signal of recentSignals) {
      const day = signal.observed_at.slice(0, 10); // YYYY-MM-DD
      const topic = signal.topic;
      if (!topicDailyCounts.has(topic)) topicDailyCounts.set(topic, new Map());
      const dayCounts = topicDailyCounts.get(topic)!;
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }

    for (const [topic, dayCounts] of topicDailyCounts) {
      const sortedDays = Array.from(dayCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      const values = sortedDays.map(([, count]) => count);
      if (values.length >= 3) {
        const changePoints = detectChangePoints(values, cusumConfig);
        // If change point in the last 2 days: topic is accelerating
        if (changePoints.some(cp => cp >= values.length - 2)) {
          topicAccelerating.add(topic);
        }
      }
    }
  }
```

**Step 4: Apply imbalance + CUSUM during thesis enrichment**

In the enrichment block where velocity/corroboration are applied to theses, also apply:

```typescript
// After existing velocity/corroboration assignment:
// Boost velocity if CUSUM detected acceleration in thesis topic
if (topicAccelerating.has(thesis.topic)) {
  bestMetrics.velocity = Math.min(10, bestMetrics.velocity * 1.5);
}
```

**Step 5: Add CUSUM config to AgentRunnerDeps**

```typescript
cusumThreshold?: number;
cusumDrift?: number;
```

And pass from main.ts:

```typescript
cusumThreshold: runtimeEnv.cusumThreshold,
cusumDrift: runtimeEnv.cusumDrift,
```

**Step 6: Run all tests**

```bash
CI=1 pnpm test
```

**Step 7: Commit**

```bash
git add apps/api/src/jobs/agent_runner.ts apps/api/src/main.ts
git commit -m "feat: integrate supply/demand imbalance and CUSUM into agent runner"
```

---

## Task 13: Schedule Backtesting Jobs in main.ts

**Files:**
- Modify: `apps/api/src/main.ts`

**Step 1: Import snapshot and validation jobs**

```typescript
import { snapshotPredictions } from './jobs/backtest_snapshot';
import { validatePredictions } from './jobs/backtest_validate';
```

**Step 2: Add weekly backtesting interval**

After the existing agent interval setup, add:

```typescript
  // Weekly backtesting: snapshot predictions + validate old ones
  const backtestIntervalMs = runtimeEnv.backtestSnapshotIntervalMs;
  const backtestTimer = setInterval(async () => {
    try {
      const snapResult = await snapshotPredictions({
        pool,
        thesisStore,
        confidenceThreshold: 50,
      });
      console.log(`[backtest] Snapshotted ${snapResult.snapshotted} predictions`);

      const valResult = await validatePredictions({
        pool,
        searchRecentSignals: async (thesisKey: string) => {
          // Search for signals matching the thesis topic in the last 30 days
          const thesis = await thesisStore.getByKey(thesisKey);
          if (!thesis) return [];
          const result = await memoryStore.querySignals({
            window: '30d',
            sort: 'blended',
            limit: 20,
          });
          // Filter to signals that match thesis topic
          return result.signals
            .filter(s => s.topic === thesis.topic || s.canonical_text.toLowerCase().includes(thesis.title.toLowerCase().split(' ')[0]))
            .map(s => ({ source: s.source, canonical_text: s.canonical_text }));
        },
        validateAfterDays: runtimeEnv.backtestValidateAfterDays,
      });
      console.log(`[backtest] Validated ${valResult.validated}/${valResult.checked} predictions`);
    } catch (err) {
      console.error('[backtest] Error:', err);
    }
  }, backtestIntervalMs);
```

**Step 3: Clear timer in shutdown handler**

Add `clearInterval(backtestTimer);` to the existing shutdown handler.

**Step 4: Run all tests**

```bash
CI=1 pnpm test
```

**Step 5: Commit**

```bash
git add apps/api/src/main.ts
git commit -m "feat: schedule weekly backtesting jobs"
```

---

## Task 14: Update API Contracts and Thesis Listing

**Files:**
- Modify: `packages/contracts/src/api.ts`
- Modify: `apps/api/src/runtime/postgres_thesis_store.ts`
- Modify: `apps/api/src/jobs/thesis_synthesizer.ts`

**Step 1: Add new fields to ThesisListItem**

In `packages/contracts/src/api.ts`, add to `ThesisListItem`:

```typescript
  debateVerdict?: 'strong_opportunity' | 'needs_investigation' | 'contested' | 'likely_noise' | null;
  categoryEmerging?: boolean;
  supplyDemand?: 'opportunity' | 'competitive' | 'niche' | 'saturated' | null;
```

**Step 2: Add debatesPerformed to AgentRunResult**

In the same file, add to `AgentRunResult`:

```typescript
  debatesPerformed?: number;
```

**Step 3: Wire debate verdict into thesis listing**

In `postgres_thesis_store.ts`, in the `listPaginated` SQL query, add a subquery to fetch the latest debate verdict per thesis:

```sql
LEFT JOIN LATERAL (
  SELECT moderator_verdict->>'verdict' AS debate_verdict
  FROM thesis_debates td
  WHERE td.thesis_key = tc.canonical_key
  ORDER BY td.created_at DESC LIMIT 1
) dv ON true
```

And include `dv.debate_verdict` in the row mapping and API response:

```typescript
debateVerdict: (row as any).debate_verdict ?? null,
```

**Step 4: Run all tests**

```bash
CI=1 pnpm test
```

**Step 5: Commit**

```bash
git add packages/contracts/src/api.ts apps/api/src/runtime/postgres_thesis_store.ts apps/api/src/jobs/thesis_synthesizer.ts
git commit -m "feat: add debate verdict and supply/demand to thesis API response"
```

---

## Task 15: UI — Debate Verdict Badge, Category Emerging, Supply/Demand

**Files:**
- Modify: `apps/web/src/components/ThesisCard.tsx`
- Modify: `apps/web/src/styles.css`

**Step 1: Add new fields to ThesisCardProps**

```typescript
debateVerdict?: 'strong_opportunity' | 'needs_investigation' | 'contested' | 'likely_noise' | null;
categoryEmerging?: boolean;
supplyDemand?: 'opportunity' | 'competitive' | 'niche' | 'saturated' | null;
```

**Step 2: Add debate verdict badge to card header**

After the scope badge and before the confidence display, add:

```typescript
{thesis.debateVerdict && (
  <span
    className={`thesis-verdict-badge verdict-${thesis.debateVerdict.replace(/_/g, '-')}`}
    title={`Debate: ${thesis.debateVerdict.replace(/_/g, ' ')}`}
  >
    {thesis.debateVerdict === 'strong_opportunity' ? '\u2713\u2713' :
     thesis.debateVerdict === 'needs_investigation' ? '?' :
     thesis.debateVerdict === 'contested' ? '\u26A0' : '\u2717'}
  </span>
)}
```

**Step 3: Add category emerging and supply/demand to meta row**

After corroboration dots, before lastSeenAt:

```typescript
{thesis.categoryEmerging && (
  <span className="thesis-category-emerging" title="Emerging category detected">{'\u2728'} new category</span>
)}
{thesis.supplyDemand && thesis.supplyDemand !== 'competitive' && (
  <span className={`thesis-imbalance imbalance-${thesis.supplyDemand}`}
        title={`Market: ${thesis.supplyDemand}`}>
    {thesis.supplyDemand === 'opportunity' ? '\u{1F7E2}' :
     thesis.supplyDemand === 'niche' ? '\u{1F7E1}' : '\u{1F534}'}
    {' '}{thesis.supplyDemand}
  </span>
)}
```

**Step 4: Add CSS**

```css
/* Debate verdict badges */
.thesis-verdict-badge {
  font-size: 0.6rem;
  font-weight: 700;
  padding: 0 0.2rem;
  border-radius: 3px;
  line-height: 1.4;
}
.verdict-strong-opportunity { color: var(--ok); border: 1px solid var(--ok); }
.verdict-needs-investigation { color: var(--warn); border: 1px solid var(--warn); }
.verdict-contested { color: var(--warn); border: 1px solid var(--warn); }
.verdict-likely-noise { color: var(--err); border: 1px solid var(--err); }

/* Category emerging */
.thesis-category-emerging {
  color: var(--accent);
  font-weight: 600;
}

/* Supply/demand imbalance */
.thesis-imbalance { font-weight: 600; }
.imbalance-opportunity { color: var(--ok); }
.imbalance-niche { color: var(--warn); }
.imbalance-saturated { color: var(--err); }
```

**Step 5: Run all tests**

```bash
CI=1 pnpm test
```

**Step 6: Commit**

```bash
git add apps/web/src/components/ThesisCard.tsx apps/web/src/styles.css
git commit -m "feat: add debate verdict, category emerging, and supply/demand UI indicators"
```

---

## Task 16: Final Integration Test — End-to-End Verification

**Files:** None (verification only)

**Step 1: Run all tests**

```bash
CI=1 pnpm test
```

Expected: ALL PASS.

**Step 2: Type-check all packages**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.json && npx tsc --noEmit -p packages/pipeline/tsconfig.json
```

Expected: No type errors.

**Step 3: Run migrations**

```bash
source .env
psql "$DATABASE_URL" -f apps/api/db/migrations/0021_thesis_debates.sql
psql "$DATABASE_URL" -f apps/api/db/migrations/0022_backtesting.sql
```

**Step 4: Start services and verify**

```bash
nohup pnpm --dir apps/api run dev > /tmp/idea-api.log 2>&1 &
nohup pnpm --dir apps/web run dev > /tmp/idea-web.log 2>&1 &
```

**Step 5: Trigger agent run and verify debate data**

```bash
curl -X POST http://localhost:3001/v1/agent/run
# Wait for completion
curl http://localhost:3001/v1/agent/status
# Check for debate transcripts
psql "$DATABASE_URL" -c "SELECT thesis_key, moderator_verdict->>'verdict' FROM thesis_debates LIMIT 5"
# Check thesis API includes new fields
curl 'http://localhost:3001/v1/theses?limit=3' | jq '.items[0] | {debateVerdict, categoryEmerging, supplyDemand}'
```

**Step 6: Commit integration verification (if any fixes needed)**

```bash
git add -A
git commit -m "fix: integration adjustments for Phase 2"
```
