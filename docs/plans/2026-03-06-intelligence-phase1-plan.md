# Phase 1: Intelligence Foundation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Bayesian thesis confidence, velocity/acceleration scoring, developer behavior signal connectors (npm, StackOverflow, Semantic Scholar), and cross-source correlation to make idea.ai's scoring genuinely predictive.

**Architecture:** Incremental, additive changes to existing scoring pipeline, thesis store, and connector system. No new infrastructure — all changes build on PostgreSQL + pgvector + existing connector interface. All existing tests must continue to pass.

**Tech Stack:** TypeScript, PostgreSQL + pgvector, Ollama, existing connector pattern, vitest

**Design doc:** `docs/plans/2026-03-06-intelligence-phase1-design.md`

---

## Task 1: Database Migration — Bayesian Columns on thesis_candidates

**Files:**
- Create: `apps/api/db/migrations/0018_bayesian_confidence.sql`

**Step 1: Write the migration**

```sql
-- 0018_bayesian_confidence.sql
-- Add Bayesian confidence tracking columns to thesis_candidates

ALTER TABLE thesis_candidates ADD COLUMN IF NOT EXISTS prior_confidence REAL DEFAULT 20;
ALTER TABLE thesis_candidates ADD COLUMN IF NOT EXISTS posterior_confidence REAL DEFAULT 20;
ALTER TABLE thesis_candidates ADD COLUMN IF NOT EXISTS evidence_count_bayes INTEGER DEFAULT 0;
ALTER TABLE thesis_candidates ADD COLUMN IF NOT EXISTS confirming_signals INTEGER DEFAULT 0;
ALTER TABLE thesis_candidates ADD COLUMN IF NOT EXISTS contradicting_signals INTEGER DEFAULT 0;
ALTER TABLE thesis_candidates ADD COLUMN IF NOT EXISTS confidence_last_updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill existing theses: set posterior_confidence = current confidence
UPDATE thesis_candidates
SET posterior_confidence = confidence,
    prior_confidence = GREATEST(confidence * 0.8, 20);
```

Note: The existing `confidence` column uses 0-100 scale. Bayesian columns also use 0-100 (not 0-1) for consistency.

**Step 2: Run the migration**

Run: `psql "$DATABASE_URL" -f apps/api/db/migrations/0018_bayesian_confidence.sql`
Expected: ALTER TABLE and UPDATE succeed with no errors.

**Step 3: Commit**

```bash
git add apps/api/db/migrations/0018_bayesian_confidence.sql
git commit -m "feat: add Bayesian confidence columns to thesis_candidates (migration 0018)"
```

---

## Task 2: Bayesian Update Engine — Core Logic

**Files:**
- Create: `packages/pipeline/src/scoring/bayesian.ts`
- Create: `packages/pipeline/tests/bayesian.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/pipeline/tests/bayesian.test.ts
import { describe, expect, it } from 'vitest';
import {
  bayesianUpdate,
  computeDecay,
  type BayesianConfig,
  type SignalEvidence,
  DEFAULT_BAYESIAN_CONFIG
} from '../src/scoring/bayesian';

describe('bayesianUpdate', () => {
  const config: BayesianConfig = DEFAULT_BAYESIAN_CONFIG;

  it('increases posterior for confirming multi-source signal', () => {
    const result = bayesianUpdate(20, {
      type: 'multi_source_convergence',
      confirming: true,
      sourceCount: 3,
    }, config);
    expect(result).toBeGreaterThan(20);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('decreases posterior for contradicting signal', () => {
    const result = bayesianUpdate(60, {
      type: 'single_high_quality',
      confirming: false,
      sourceCount: 1,
    }, config);
    expect(result).toBeLessThan(60);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('clamps posterior to [0, 100]', () => {
    const high = bayesianUpdate(99, {
      type: 'multi_source_convergence',
      confirming: true,
      sourceCount: 5,
    }, config);
    expect(high).toBeLessThanOrEqual(100);

    const low = bayesianUpdate(1, {
      type: 'multi_source_convergence',
      confirming: false,
      sourceCount: 5,
    }, config);
    expect(low).toBeGreaterThanOrEqual(0);
  });

  it('weak signal barely moves confidence', () => {
    const result = bayesianUpdate(50, {
      type: 'weak_noisy',
      confirming: true,
      sourceCount: 1,
    }, config);
    expect(result).toBeGreaterThan(50);
    expect(result).toBeLessThan(56); // barely moved
  });
});

describe('computeDecay', () => {
  it('returns same confidence if within grace period', () => {
    expect(computeDecay(80, 10, DEFAULT_BAYESIAN_CONFIG)).toBe(80);
  });

  it('decays confidence after grace period', () => {
    const decayed = computeDecay(80, 20, DEFAULT_BAYESIAN_CONFIG);
    expect(decayed).toBeLessThan(80);
    expect(decayed).toBeGreaterThan(0);
  });

  it('never decays below floor', () => {
    const decayed = computeDecay(80, 100, DEFAULT_BAYESIAN_CONFIG);
    expect(decayed).toBeGreaterThanOrEqual(DEFAULT_BAYESIAN_CONFIG.floorConfidence);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm --filter @idea/pipeline exec vitest run tests/bayesian.test.ts`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

```typescript
// packages/pipeline/src/scoring/bayesian.ts

export type SignalEvidenceType =
  | 'multi_source_convergence'
  | 'single_high_quality'
  | 'github_repo_growth'
  | 'stackoverflow_spike'
  | 'enterprise_adoption'
  | 'weak_noisy';

export type SignalEvidence = {
  type: SignalEvidenceType;
  confirming: boolean;
  sourceCount: number;
};

export type BayesianConfig = {
  defaultPrior: number;        // 0-100 scale
  decayRate: number;           // daily multiplier (e.g. 0.97)
  decayAfterDays: number;      // grace period before decay starts
  floorConfidence: number;     // minimum confidence after decay
};

export const DEFAULT_BAYESIAN_CONFIG: BayesianConfig = {
  defaultPrior: 20,
  decayRate: 0.97,
  decayAfterDays: 14,
  floorConfidence: 5,
};

// Likelihood ratios for each signal type (from design doc)
const LIKELIHOOD_RATIOS: Record<SignalEvidenceType, { confirming: number; contradicting: number }> = {
  multi_source_convergence: { confirming: 2.2, contradicting: 0.4 },
  single_high_quality:      { confirming: 1.6, contradicting: 0.6 },
  github_repo_growth:       { confirming: 1.7, contradicting: 0.7 },
  stackoverflow_spike:      { confirming: 1.6, contradicting: 0.8 },
  enterprise_adoption:      { confirming: 2.2, contradicting: 0.5 },
  weak_noisy:               { confirming: 1.1, contradicting: 0.9 },
};

const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

/**
 * Apply a Bayesian update to thesis confidence.
 * Operates on 0-100 scale. Internally converts to 0-1 probability for the
 * Bayes rule calculation, then converts back.
 */
export const bayesianUpdate = (
  priorConfidence: number,
  evidence: SignalEvidence,
  _config: BayesianConfig = DEFAULT_BAYESIAN_CONFIG,
): number => {
  const prior = clamp(priorConfidence, 0, 100) / 100;
  const ratios = LIKELIHOOD_RATIOS[evidence.type] ?? LIKELIHOOD_RATIOS.weak_noisy;
  const lr = evidence.confirming ? ratios.confirming : ratios.contradicting;

  // Bayes rule: posterior = prior * LR / (prior * LR + (1 - prior))
  const numerator = prior * lr;
  const denominator = numerator + (1 - prior);
  const posterior = denominator > 0 ? numerator / denominator : prior;

  return clamp(Math.round(posterior * 10000) / 100, 0, 100);
};

/**
 * Compute confidence after N days of no confirming signals.
 * Decay only starts after the grace period.
 */
export const computeDecay = (
  confidence: number,
  daysSinceLastSignal: number,
  config: BayesianConfig = DEFAULT_BAYESIAN_CONFIG,
): number => {
  if (daysSinceLastSignal <= config.decayAfterDays) return confidence;

  const decayDays = daysSinceLastSignal - config.decayAfterDays;
  const decayed = confidence * Math.pow(config.decayRate, decayDays);
  return Math.max(Math.round(decayed * 100) / 100, config.floorConfidence);
};
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm --filter @idea/pipeline exec vitest run tests/bayesian.test.ts`
Expected: All tests PASS.

**Step 5: Run full test suite**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm test`
Expected: All existing tests continue to pass.

**Step 6: Commit**

```bash
git add packages/pipeline/src/scoring/bayesian.ts packages/pipeline/tests/bayesian.test.ts
git commit -m "feat: Bayesian confidence update engine with likelihood ratios and decay"
```

---

## Task 3: Env Vars for Bayesian Config

**Files:**
- Modify: `apps/api/src/config/env.ts`
- Modify: `.env.example`

**Step 1: Add Bayesian config to RuntimeEnv**

In `apps/api/src/config/env.ts`, add to `RuntimeEnv` type:

```typescript
bayesianPriorDefault: number;
bayesianDecayRate: number;
bayesianDecayAfterDays: number;
bayesianFloorConfidence: number;
```

In `loadRuntimeEnv`, add parsing:

```typescript
bayesianPriorDefault: parseNumber(env.BAYESIAN_PRIOR_DEFAULT, 20),
bayesianDecayRate: parseNumber(env.BAYESIAN_DECAY_RATE, 0.97),
bayesianDecayAfterDays: parseNumber(env.BAYESIAN_DECAY_AFTER_DAYS, 14),
bayesianFloorConfidence: parseNumber(env.BAYESIAN_FLOOR_CONFIDENCE, 5),
```

**Step 2: Update .env.example**

Add after the circuit breaker section:

```
# Bayesian confidence engine
BAYESIAN_PRIOR_DEFAULT=20
BAYESIAN_DECAY_RATE=0.97
BAYESIAN_DECAY_AFTER_DAYS=14
BAYESIAN_FLOOR_CONFIDENCE=5
```

**Step 3: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add apps/api/src/config/env.ts .env.example
git commit -m "feat: add Bayesian confidence env vars"
```

---

## Task 4: Velocity Scoring — Core Logic

**Files:**
- Create: `packages/pipeline/src/scoring/velocity.ts`
- Create: `packages/pipeline/tests/velocity.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/pipeline/tests/velocity.test.ts
import { describe, expect, it } from 'vitest';
import { computeVelocity, velocityMultiplier } from '../src/scoring/velocity';

describe('computeVelocity', () => {
  it('returns 1 when 7d count equals avg weekly', () => {
    expect(computeVelocity(10, 10)).toBe(1);
  });

  it('returns > 1 when 7d count exceeds avg weekly', () => {
    expect(computeVelocity(30, 10)).toBe(3);
  });

  it('returns < 1 when 7d count is below avg weekly', () => {
    expect(computeVelocity(5, 10)).toBe(0.5);
  });

  it('returns 1 when avg weekly is 0', () => {
    expect(computeVelocity(5, 0)).toBe(1);
  });

  it('returns 1 when both are 0', () => {
    expect(computeVelocity(0, 0)).toBe(1);
  });
});

describe('velocityMultiplier', () => {
  it('returns 1.0 for velocity = 1 (stable)', () => {
    expect(velocityMultiplier(1)).toBe(1);
  });

  it('returns > 1.0 for growing topic', () => {
    expect(velocityMultiplier(2)).toBeGreaterThan(1);
  });

  it('returns < 1.0 for declining topic', () => {
    expect(velocityMultiplier(0.5)).toBeLessThan(1);
  });

  it('clamps to max 2.0', () => {
    expect(velocityMultiplier(100)).toBe(2);
  });

  it('clamps to min 0.5', () => {
    expect(velocityMultiplier(0)).toBe(0.5);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm --filter @idea/pipeline exec vitest run tests/velocity.test.ts`
Expected: FAIL — module not found.

**Step 3: Write minimal implementation**

```typescript
// packages/pipeline/src/scoring/velocity.ts

/**
 * Compute velocity: ratio of 7-day signal count to average weekly count.
 * velocity > 1 = growing, velocity < 1 = declining.
 */
export const computeVelocity = (
  weekCount: number,
  avgWeeklyCount: number,
): number => {
  if (avgWeeklyCount <= 0) return 1;
  return Math.round((weekCount / avgWeeklyCount) * 100) / 100;
};

/**
 * Convert velocity to a score multiplier.
 * Formula: CLAMP(0.5 + 0.5 * velocity, 0.5, 2.0)
 *
 * - Declining (velocity < 1): penalized up to 50%
 * - Stable (velocity = 1): no change (multiplier = 1.0)
 * - Growing (velocity > 1): boosted up to 2x
 */
export const velocityMultiplier = (velocity: number): number => {
  const raw = 0.5 + 0.5 * velocity;
  return Math.round(Math.max(0.5, Math.min(2.0, raw)) * 100) / 100;
};
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm --filter @idea/pipeline exec vitest run tests/velocity.test.ts`
Expected: All tests PASS.

**Step 5: Run full test suite**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm test`
Expected: All existing tests continue to pass.

**Step 6: Commit**

```bash
git add packages/pipeline/src/scoring/velocity.ts packages/pipeline/tests/velocity.test.ts
git commit -m "feat: velocity scoring with multiplier for growing/declining topics"
```

---

## Task 5: Integrate Velocity into Blend Formula

**Files:**
- Modify: `packages/pipeline/src/scoring/blend.ts`
- Modify: `packages/pipeline/tests/scoring.test.ts`

**Step 1: Add velocity-aware blended score**

The existing `blendedScore` must remain unchanged for backwards compatibility. Add a new exported function:

In `packages/pipeline/src/scoring/blend.ts`:

```typescript
export type Scores = {
  demand: number;
  timing: number;
  buildability: number;
  virality: number;
};

export const blendedScore = ({ demand, timing, buildability, virality }: Scores): number =>
  Math.round((0.25 * demand + 0.20 * timing + 0.20 * buildability + 0.35 * virality) * 100) / 100;

export const blendedScoreWithVelocity = (scores: Scores, velocity: number): number => {
  const base = blendedScore(scores);
  const { velocityMultiplier } = require('./velocity');
  const multiplier = velocityMultiplier(velocity);
  return Math.round(base * multiplier * 100) / 100;
};
```

Wait — dynamic require is bad in ESM. Let's use a static import instead:

```typescript
import { velocityMultiplier } from './velocity';

export type Scores = {
  demand: number;
  timing: number;
  buildability: number;
  virality: number;
};

export const blendedScore = ({ demand, timing, buildability, virality }: Scores): number =>
  Math.round((0.25 * demand + 0.20 * timing + 0.20 * buildability + 0.35 * virality) * 100) / 100;

export const blendedScoreWithVelocity = (scores: Scores, velocity: number): number => {
  const base = blendedScore(scores);
  const multiplier = velocityMultiplier(velocity);
  return Math.round(base * multiplier * 100) / 100;
};
```

**Step 2: Add tests for velocity blend**

Append to `packages/pipeline/tests/scoring.test.ts`:

```typescript
import { blendedScoreWithVelocity } from '../src/scoring/blend';

// Inside the existing describe('scoring pipeline', ...) block:
it('applies velocity multiplier to blended score', () => {
  const scores = { demand: 80, timing: 70, buildability: 60, virality: 90 };
  // Base score = 77.5
  // velocity 2.0 → multiplier 1.5 → 77.5 * 1.5 = 116.25
  expect(blendedScoreWithVelocity(scores, 2.0)).toBe(116.25);
});

it('penalizes declining topics', () => {
  const scores = { demand: 80, timing: 70, buildability: 60, virality: 90 };
  // velocity 0.5 → multiplier 0.75 → 77.5 * 0.75 = 58.13
  expect(blendedScoreWithVelocity(scores, 0.5)).toBe(58.13);
});

it('leaves stable topics unchanged', () => {
  const scores = { demand: 80, timing: 70, buildability: 60, virality: 90 };
  expect(blendedScoreWithVelocity(scores, 1.0)).toBe(77.5);
});
```

**Step 3: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm --filter @idea/pipeline exec vitest run tests/scoring.test.ts`
Expected: All tests PASS (both old and new).

**Step 4: Run full test suite**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm test`
Expected: All pass.

**Step 5: Commit**

```bash
git add packages/pipeline/src/scoring/blend.ts packages/pipeline/tests/scoring.test.ts
git commit -m "feat: add blendedScoreWithVelocity to apply velocity multiplier"
```

---

## Task 6: npm Download Trends Connector

**Files:**
- Create: `packages/connectors/src/npm_trends.ts`
- Create: `packages/connectors/tests/npm_trends.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/connectors/tests/npm_trends.test.ts
import { describe, expect, it, vi } from 'vitest';
import { fetchNpmTrends, type NpmTrendsOptions } from '../src/npm_trends';

const makeFetch = (responses: Record<string, { downloads: number }>) => {
  return vi.fn(async (url: string) => ({
    ok: true,
    json: async () => {
      const pkg = url.split('/').pop() ?? '';
      return responses[pkg] ?? { downloads: 0 };
    },
  })) as unknown as typeof fetch;
};

describe('fetchNpmTrends', () => {
  it('returns events for packages with download data', async () => {
    const mockFetch = makeFetch({
      langchain: { downloads: 50000 },
      'llamaindex': { downloads: 30000 },
    });

    const events = await fetchNpmTrends({
      categories: { 'ai-agents': ['langchain', 'llamaindex'] },
      fetchImpl: mockFetch,
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].source).toBe('npm_trends');
    expect(events[0].text).toContain('ai-agents');
  });

  it('returns empty array when fetch fails', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const events = await fetchNpmTrends({ fetchImpl: mockFetch });
    expect(events).toEqual([]);
  });

  it('uses source_item_id with category and date', async () => {
    const mockFetch = makeFetch({ langchain: { downloads: 50000 } });
    const events = await fetchNpmTrends({
      categories: { 'ai-agents': ['langchain'] },
      fetchImpl: mockFetch,
    });

    expect(events[0].source_item_id).toMatch(/^npm:ai-agents:\d{4}-\d{2}-\d{2}$/);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm --filter @idea/connectors exec vitest run tests/npm_trends.test.ts`
Expected: FAIL — module not found.

**Step 3: Write implementation**

```typescript
// packages/connectors/src/npm_trends.ts
import type { RawEventInput } from './common/http';

const NPM_API = 'https://api.npmjs.org/downloads/point/last-week';

const DEFAULT_CATEGORIES: Record<string, string[]> = {
  'ai-agents': ['langchain', 'llamaindex', '@ai-sdk/core', 'autogen'],
  'vector-db': ['chromadb', '@pinecone-database/pinecone', 'weaviate-client', '@qdrant/js-client-rest'],
  'auth': ['lucia', 'better-auth', '@clerk/clerk-sdk-node', 'auth0'],
  'payments': ['stripe', '@lemonsqueezy/lemonsqueezy.js'],
  'observability': ['@opentelemetry/sdk-node', '@sentry/node', 'pino', 'winston'],
  'database': ['drizzle-orm', 'prisma', '@electric-sql/pglite', 'kysely'],
  'realtime': ['socket.io', 'ws', 'ably', 'pusher'],
  'testing': ['vitest', 'playwright', '@testing-library/react', 'cypress'],
  'ui-frameworks': ['svelte', 'solid-js', 'qwik', 'htmx.org'],
  'edge-compute': ['hono', 'elysia', '@cloudflare/workers-types'],
};

export type NpmTrendsOptions = {
  categories?: Record<string, string[]>;
  fetchImpl?: typeof fetch;
};

export const fetchNpmTrends = async (
  opts: NpmTrendsOptions = {},
): Promise<RawEventInput[]> => {
  const { categories = DEFAULT_CATEGORIES, fetchImpl = fetch } = opts;
  const events: RawEventInput[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const [category, packages] of Object.entries(categories)) {
    const downloads: { pkg: string; count: number }[] = [];

    for (const pkg of packages) {
      try {
        const res = await fetchImpl(`${NPM_API}/${encodeURIComponent(pkg)}`);
        if (!res.ok) continue;
        const data = (await res.json()) as { downloads?: number };
        if (data.downloads != null && data.downloads > 0) {
          downloads.push({ pkg, count: data.downloads });
        }
      } catch {
        // Skip failed fetches for individual packages
      }
    }

    if (downloads.length === 0) continue;

    const totalDownloads = downloads.reduce((sum, d) => sum + d.count, 0);
    const topMovers = downloads
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((d) => `${d.pkg} (${d.count.toLocaleString()})`)
      .join(', ');

    events.push({
      source: 'npm_trends',
      source_item_id: `npm:${category}:${today}`,
      source_timestamp: new Date().toISOString(),
      text: `npm category "${category}" weekly downloads: ${totalDownloads.toLocaleString()}. Top packages: ${topMovers}. This suggests developer adoption trends in ${category} tooling.`,
      url: `https://npmtrends.com/${downloads[0]?.pkg ?? packages[0]}`,
      engagement_count: totalDownloads,
    });
  }

  return events;
};
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm --filter @idea/connectors exec vitest run tests/npm_trends.test.ts`
Expected: All tests PASS.

**Step 5: Run full test suite**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm test`
Expected: All pass.

**Step 6: Commit**

```bash
git add packages/connectors/src/npm_trends.ts packages/connectors/tests/npm_trends.test.ts
git commit -m "feat: npm download trends connector with category tracking"
```

---

## Task 7: StackOverflow Unanswered Questions Connector (Upgrade)

The existing `packages/connectors/src/stackoverflow.ts` is a basic connector that fetches recent questions. Upgrade it to also track unanswered questions and include engagement metrics.

**Files:**
- Modify: `packages/connectors/src/stackoverflow.ts`
- Create: `packages/connectors/tests/stackoverflow.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/connectors/tests/stackoverflow.test.ts
import { describe, expect, it, vi } from 'vitest';
import { fetchStackOverflow } from '../src/stackoverflow';

describe('fetchStackOverflow', () => {
  it('returns events with source stackoverflow', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          {
            question_id: 123,
            title: 'How to handle multi-tenant DB migrations?',
            tags: ['prisma', 'postgresql', 'multi-tenancy'],
            creation_date: Math.floor(Date.now() / 1000),
            link: 'https://stackoverflow.com/q/123',
            view_count: 500,
            answer_count: 0,
            score: 15,
            is_answered: false,
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const events = await fetchStackOverflow({ fetchImpl: mockFetch });
    expect(events.length).toBe(1);
    expect(events[0].source).toBe('stackoverflow');
    expect(events[0].text).toContain('prisma');
    expect(events[0].engagement_count).toBeDefined();
  });

  it('includes engagement_count from views + score', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          {
            question_id: 456,
            title: 'Auth issue',
            tags: ['auth0'],
            creation_date: Math.floor(Date.now() / 1000),
            link: 'https://stackoverflow.com/q/456',
            view_count: 1000,
            answer_count: 2,
            score: 25,
            is_answered: true,
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const events = await fetchStackOverflow({ fetchImpl: mockFetch });
    expect(events[0].engagement_count).toBe(1025);
  });

  it('returns empty array on API failure', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const events = await fetchStackOverflow({ fetchImpl: mockFetch });
    expect(events).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm --filter @idea/connectors exec vitest run tests/stackoverflow.test.ts`
Expected: FAIL (engagement_count not set in current implementation).

**Step 3: Update implementation**

Replace `packages/connectors/src/stackoverflow.ts`:

```typescript
// packages/connectors/src/stackoverflow.ts
import type { RawEventInput } from './common/http.js';

const API_BASE = 'https://api.stackexchange.com/2.3';

interface SOOptions {
  tags?: string[];
  pageSize?: number;
  fetchImpl?: typeof fetch;
}

type SOQuestion = {
  question_id: number;
  title: string;
  tags?: string[];
  creation_date: number;
  link: string;
  view_count?: number;
  answer_count?: number;
  score?: number;
  is_answered?: boolean;
};

export async function fetchStackOverflow(opts: SOOptions = {}): Promise<RawEventInput[]> {
  const {
    tags = ['enterprise-integration', 'devops', 'saas', 'prisma', 'auth0', 'stripe', 'kubernetes', 'docker', 'aws', 'ai-agent'],
    pageSize = 25,
    fetchImpl = fetch,
  } = opts;
  const tagStr = tags.join(';');
  const url = `${API_BASE}/questions?order=desc&sort=activity&tagged=${encodeURIComponent(tagStr)}&site=stackoverflow&pagesize=${pageSize}&filter=withbody`;

  const res = await fetchImpl(url);
  if (!res.ok) return [];

  const data = await res.json();
  const items: SOQuestion[] = data.items ?? [];

  return items.map((q) => {
    const questionTags = q.tags ?? [];
    const unansweredLabel = q.is_answered === false ? ' [UNANSWERED]' : '';

    return {
      source: 'stackoverflow',
      source_item_id: `so-${q.question_id}`,
      source_timestamp: new Date(q.creation_date * 1000).toISOString(),
      text: `[${questionTags.join(', ')}]${unansweredLabel} ${q.title}`.slice(0, 2000),
      url: q.link,
      engagement_count: (q.view_count ?? 0) + (q.score ?? 0),
    };
  });
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm --filter @idea/connectors exec vitest run tests/stackoverflow.test.ts`
Expected: All tests PASS.

**Step 5: Run full test suite**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm test`
Expected: All pass.

**Step 6: Commit**

```bash
git add packages/connectors/src/stackoverflow.ts packages/connectors/tests/stackoverflow.test.ts
git commit -m "feat: upgrade StackOverflow connector with engagement metrics and unanswered labels"
```

---

## Task 8: Semantic Scholar Connector

**Files:**
- Create: `packages/connectors/src/semantic_scholar.ts`
- Create: `packages/connectors/tests/semantic_scholar.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/connectors/tests/semantic_scholar.test.ts
import { describe, expect, it, vi } from 'vitest';
import { fetchSemanticScholar } from '../src/semantic_scholar';

describe('fetchSemanticScholar', () => {
  it('returns events from paper search results', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            paperId: 'abc123',
            title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
            abstract: 'We explore a general-purpose fine-tuning recipe...',
            citationCount: 450,
            year: 2025,
            venue: 'NeurIPS',
            url: 'https://api.semanticscholar.org/abc123',
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const events = await fetchSemanticScholar({
      topics: ['retrieval augmented generation'],
      fetchImpl: mockFetch,
    });

    expect(events.length).toBe(1);
    expect(events[0].source).toBe('semantic_scholar');
    expect(events[0].text).toContain('Retrieval-Augmented Generation');
    expect(events[0].engagement_count).toBe(450);
  });

  it('returns empty array on API failure', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const events = await fetchSemanticScholar({ fetchImpl: mockFetch });
    expect(events).toEqual([]);
  });

  it('filters out papers with no title', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { paperId: 'x1', title: null, abstract: null, citationCount: 10, year: 2025 },
          { paperId: 'x2', title: 'Valid Paper', abstract: 'text', citationCount: 20, year: 2025, url: 'https://example.com' },
        ],
      }),
    })) as unknown as typeof fetch;

    const events = await fetchSemanticScholar({
      topics: ['test'],
      fetchImpl: mockFetch,
    });

    expect(events.length).toBe(1);
    expect(events[0].text).toContain('Valid Paper');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm --filter @idea/connectors exec vitest run tests/semantic_scholar.test.ts`
Expected: FAIL — module not found.

**Step 3: Write implementation**

```typescript
// packages/connectors/src/semantic_scholar.ts
import type { RawEventInput } from './common/http';

const API_BASE = 'https://api.semanticscholar.org/graph/v1/paper/search';

const DEFAULT_TOPICS = [
  'AI agents',
  'retrieval augmented generation',
  'vector databases',
  'code generation',
  'developer tools machine learning',
  'SaaS automation',
  'large language model applications',
];

export type SemanticScholarOptions = {
  topics?: string[];
  yearRange?: string;
  limit?: number;
  fetchImpl?: typeof fetch;
};

type Paper = {
  paperId: string;
  title: string | null;
  abstract: string | null;
  citationCount: number;
  year: number;
  venue?: string;
  url?: string;
};

export const fetchSemanticScholar = async (
  opts: SemanticScholarOptions = {},
): Promise<RawEventInput[]> => {
  const {
    topics = DEFAULT_TOPICS,
    yearRange = '2024-2026',
    limit = 5,
    fetchImpl = fetch,
  } = opts;

  const events: RawEventInput[] = [];

  for (const topic of topics) {
    try {
      const params = new URLSearchParams({
        query: topic,
        year: yearRange,
        fieldsOfStudy: 'Computer Science',
        fields: 'title,abstract,citationCount,year,venue,url',
        limit: String(limit),
      });

      const res = await fetchImpl(`${API_BASE}?${params.toString()}`);
      if (!res.ok) continue;

      const data = (await res.json()) as { data?: Paper[] };
      const papers = data.data ?? [];

      for (const paper of papers) {
        if (!paper.title) continue;

        const venueLabel = paper.venue ? ` [${paper.venue}]` : '';
        const abstractSnippet = paper.abstract ? ` — ${paper.abstract.slice(0, 200)}` : '';

        events.push({
          source: 'semantic_scholar',
          source_item_id: `scholar-${paper.paperId}`,
          source_timestamp: new Date().toISOString(),
          text: `${paper.title}${venueLabel} (${paper.year}, ${paper.citationCount} citations)${abstractSnippet}`,
          url: paper.url ?? `https://www.semanticscholar.org/paper/${paper.paperId}`,
          engagement_count: paper.citationCount,
        });
      }
    } catch {
      // Skip failed topic queries
    }
  }

  return events;
};
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm --filter @idea/connectors exec vitest run tests/semantic_scholar.test.ts`
Expected: All tests PASS.

**Step 5: Run full test suite**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm test`
Expected: All pass.

**Step 6: Commit**

```bash
git add packages/connectors/src/semantic_scholar.ts packages/connectors/tests/semantic_scholar.test.ts
git commit -m "feat: Semantic Scholar connector for academic paper tracking"
```

---

## Task 9: Wire New Connectors into Ingestion Pipeline

**Files:**
- Modify: `packages/connectors/src/common/http.ts` — add to LIMITS and CADENCE
- Modify: `apps/api/src/jobs/ingest_open.ts` — add imports and loaders
- Modify: `apps/api/src/runtime/live_read_model.ts` — add to OPEN_CONNECTORS
- Modify: `apps/web/src/connectorNames.ts` — add display names

**Step 1: Add npm_trends and semantic_scholar to LIMITS and CADENCE**

In `packages/connectors/src/common/http.ts`:

Add to `OPEN_CONNECTOR_LIMITS`:
```typescript
npm_trends: 30,
semantic_scholar: 30,
```

Add to `OPEN_CONNECTOR_CADENCE`:
```typescript
npm_trends: 'daily',
semantic_scholar: 'daily',
```

**Step 2: Update OpenConnectorName type and wiring in ingest_open.ts**

In `apps/api/src/jobs/ingest_open.ts`:

Add imports:
```typescript
import { fetchNpmTrends } from '@idea/connectors/src/npm_trends';
import { fetchSemanticScholar } from '@idea/connectors/src/semantic_scholar';
```

Add to `OpenConnectorName` type:
```typescript
| 'npm_trends' | 'semantic_scholar'
```

Add to `CONNECTOR_ORDER`:
```typescript
'npm_trends', 'semantic_scholar'
```

Add to `defaultLoaders`:
```typescript
npm_trends: () => fetchNpmTrends(),
semantic_scholar: () => fetchSemanticScholar(),
```

**Step 3: Update OPEN_CONNECTORS in live_read_model.ts**

In `apps/api/src/runtime/live_read_model.ts`, add to the `OPEN_CONNECTORS` array:

```typescript
'npm_trends', 'semantic_scholar'
```

**Step 4: Update connector display names**

In `apps/web/src/connectorNames.ts`:

```typescript
npm_trends: 'npm Trends',
semantic_scholar: 'Semantic Scholar',
```

**Step 5: Run full test suite**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add packages/connectors/src/common/http.ts apps/api/src/jobs/ingest_open.ts apps/api/src/runtime/live_read_model.ts apps/web/src/connectorNames.ts
git commit -m "feat: wire npm_trends and semantic_scholar connectors into pipeline"
```

---

## Task 10: Cross-Source Correlation — Source Category Mapping

**Files:**
- Create: `packages/pipeline/src/scoring/correlation.ts`
- Create: `packages/pipeline/tests/correlation.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/pipeline/tests/correlation.test.ts
import { describe, expect, it } from 'vitest';
import {
  corroborationScore,
  sourceCategory,
  uniqueSourceCategories,
  type SourceCategory,
} from '../src/scoring/correlation';

describe('sourceCategory', () => {
  it('maps github_issues to developer', () => {
    expect(sourceCategory('github_issues')).toBe('developer');
  });

  it('maps producthunt to market', () => {
    expect(sourceCategory('producthunt')).toBe('market');
  });

  it('maps unknown sources to other', () => {
    expect(sourceCategory('unknown_source')).toBe('other');
  });
});

describe('uniqueSourceCategories', () => {
  it('counts unique categories from source list', () => {
    const categories = uniqueSourceCategories(['github_issues', 'hacker_news', 'reddit', 'producthunt']);
    expect(categories.size).toBe(3); // developer, consumer, market
  });

  it('deduplicates same-category sources', () => {
    const categories = uniqueSourceCategories(['github_issues', 'hacker_news', 'stackoverflow']);
    expect(categories.size).toBe(1); // all developer
  });
});

describe('corroborationScore', () => {
  it('returns 0 for empty sources', () => {
    expect(corroborationScore([])).toBe(0);
  });

  it('returns higher score for more diverse sources', () => {
    const single = corroborationScore(['github_issues']);
    const diverse = corroborationScore(['github_issues', 'producthunt', 'g2_reviews', 'reddit']);
    expect(diverse).toBeGreaterThan(single);
  });

  it('returns 1.0 for all categories represented', () => {
    const all = corroborationScore([
      'github_issues',   // developer
      'producthunt',     // market
      'semantic_scholar',// academic
      'g2_reviews',      // enterprise
      'reddit',          // consumer
    ]);
    expect(all).toBe(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm --filter @idea/pipeline exec vitest run tests/correlation.test.ts`
Expected: FAIL — module not found.

**Step 3: Write implementation**

```typescript
// packages/pipeline/src/scoring/correlation.ts

export type SourceCategory = 'developer' | 'market' | 'academic' | 'enterprise' | 'consumer' | 'other';

const SOURCE_TO_CATEGORY: Record<string, SourceCategory> = {
  github_issues: 'developer',
  hacker_news: 'developer',
  hn: 'developer',
  stackoverflow: 'developer',
  npm_trends: 'developer',
  lobsters: 'developer',
  devto: 'developer',
  showhn: 'developer',
  homebrew: 'developer',
  producthunt: 'market',
  appstore_trending: 'market',
  yc_companies: 'market',
  alternativeto: 'market',
  google_trends: 'market',
  semantic_scholar: 'academic',
  g2_reviews: 'enterprise',
  greenhouse: 'enterprise',
  lever: 'enterprise',
  reddit: 'consumer',
  indiehackers: 'consumer',
  mastodon: 'consumer',
  bluesky: 'consumer',
  tiktok_creative: 'consumer',
};

const TOTAL_CATEGORIES = 5; // developer, market, academic, enterprise, consumer

export const sourceCategory = (source: string): SourceCategory =>
  SOURCE_TO_CATEGORY[source] ?? 'other';

export const uniqueSourceCategories = (sources: string[]): Set<SourceCategory> => {
  const categories = new Set<SourceCategory>();
  for (const source of sources) {
    const cat = sourceCategory(source);
    if (cat !== 'other') categories.add(cat);
  }
  return categories;
};

/**
 * Corroboration score: fraction of total source categories represented.
 * 0 = no sources, 1 = all 5 categories have signals.
 */
export const corroborationScore = (sources: string[]): number => {
  if (sources.length === 0) return 0;
  const categories = uniqueSourceCategories(sources);
  return Math.round((categories.size / TOTAL_CATEGORIES) * 100) / 100;
};
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm --filter @idea/pipeline exec vitest run tests/correlation.test.ts`
Expected: All tests PASS.

**Step 5: Run full test suite**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm test`
Expected: All pass.

**Step 6: Commit**

```bash
git add packages/pipeline/src/scoring/correlation.ts packages/pipeline/tests/correlation.test.ts
git commit -m "feat: cross-source correlation scoring with source category mapping"
```

---

## Task 11: Temporal RAG Env Vars

**Files:**
- Modify: `apps/api/src/config/env.ts`
- Modify: `.env.example`

**Step 1: Add temporal RAG config to RuntimeEnv**

In `apps/api/src/config/env.ts`, add to `RuntimeEnv` type:

```typescript
temporalRagWeight: number;
temporalRagHalfLifeHours: number;
```

In `loadRuntimeEnv`, add parsing:

```typescript
temporalRagWeight: parseNumber(env.TEMPORAL_RAG_WEIGHT, 0.3),
temporalRagHalfLifeHours: parseNumber(env.TEMPORAL_RAG_HALF_LIFE_HOURS, 72),
```

**Step 2: Update .env.example**

Add after Bayesian section:

```
# Temporal RAG (recency-weighted retrieval)
TEMPORAL_RAG_WEIGHT=0.3
TEMPORAL_RAG_HALF_LIFE_HOURS=72
```

**Step 3: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add apps/api/src/config/env.ts .env.example
git commit -m "feat: add temporal RAG and velocity env vars"
```

---

## Task 12: Integrate Bayesian Updates into Research Agent

This task wires the Bayesian update engine into `research_agent.ts` so that thesis confidence accumulates via Bayesian updates rather than being overwritten.

**Files:**
- Modify: `apps/api/src/runtime/postgres_thesis_store.ts` — add `bayesianUpdate` method
- Modify: `apps/api/src/runtime/thesis_store.ts` — add method to interface

**Step 1: Add bayesianUpdate to ThesisStore interface**

In `apps/api/src/runtime/thesis_store.ts`, add to the `ThesisStore` interface:

```typescript
bayesianUpdate?(canonicalKey: string, confidenceDelta: number): Promise<void>;
```

**Step 2: Add bayesianUpdate method to PostgresThesisStore**

In `apps/api/src/runtime/postgres_thesis_store.ts`, add a new method to the returned object in `createPostgresThesisStore`:

```typescript
async bayesianUpdate(canonicalKey: string, confidenceDelta: number): Promise<void> {
  // Store prior, compute new posterior from delta
  // confidence_delta from the agent is -20 to +20
  // Apply it as a bounded update to posterior_confidence
  await pool.query(
    `UPDATE thesis_candidates
     SET prior_confidence = posterior_confidence,
         posterior_confidence = GREATEST(0, LEAST(100, posterior_confidence + $2)),
         confidence = GREATEST(0, LEAST(100, posterior_confidence + $2)),
         confidence_last_updated_at = NOW(),
         evidence_count_bayes = evidence_count_bayes + 1,
         confirming_signals = CASE WHEN $2 > 0 THEN confirming_signals + 1 ELSE confirming_signals END,
         contradicting_signals = CASE WHEN $2 < 0 THEN contradicting_signals + 1 ELSE contradicting_signals END,
         updated_at = NOW()
     WHERE canonical_key = $1`,
    [canonicalKey, confidenceDelta]
  );
},
```

**Step 3: Run full test suite**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm test`
Expected: All tests pass (this is an additive, optional method).

**Step 4: Commit**

```bash
git add apps/api/src/runtime/thesis_store.ts apps/api/src/runtime/postgres_thesis_store.ts
git commit -m "feat: add bayesianUpdate method to thesis store for incremental confidence updates"
```

---

## Task 13: Add posteriorConfidence to ThesisListItem API Contract

**Files:**
- Modify: `packages/contracts/src/api.ts`

**Step 1: Add fields to ThesisListItem type**

In `packages/contracts/src/api.ts`, add to the `ThesisListItem` type:

```typescript
posteriorConfidence?: number;
velocity?: number;
corroborationScore?: number;
```

**Step 2: Run full test suite**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm test`
Expected: All tests pass (optional fields, no breakage).

**Step 3: Commit**

```bash
git add packages/contracts/src/api.ts
git commit -m "feat: add posteriorConfidence, velocity, corroborationScore to ThesisListItem"
```

---

## Task 14: Wire posteriorConfidence into Thesis Listing

**Files:**
- Modify: `apps/api/src/runtime/postgres_thesis_store.ts` — include new columns in queries

**Step 1: Update ThesisRow and rowToDraft**

Add to `ThesisRow` type:

```typescript
posterior_confidence: number | string | null;
```

Add to `rowToDraft` return:

```typescript
posteriorConfidence: toNumber(row.posterior_confidence ?? row.confidence),
```

**Step 2: Update SQL queries to include posterior_confidence**

The `list`, `getByKey`, and `listPaginated` queries already do `SELECT tc.*`, so `posterior_confidence` is already fetched — it just needs to be mapped in `rowToDraft`.

**Step 3: Update listPaginated items mapping**

In the `listPaginated` method, add to the items mapping:

```typescript
posteriorConfidence: (d as any).posteriorConfidence ?? d.confidence,
```

**Step 4: Run full test suite**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add apps/api/src/runtime/postgres_thesis_store.ts
git commit -m "feat: expose posteriorConfidence in thesis listings"
```

---

## Task 15: Final Integration Test — End-to-End Verification

**Step 1: Run the complete test suite**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm test`
Expected: All 250+ tests pass.

**Step 2: Run lint check**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm --filter @idea/pipeline exec biome check src/ tests/ && pnpm --filter @idea/connectors exec biome check src/ tests/`
Expected: No errors.

**Step 3: Verify TypeScript compilation**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm --filter @idea/pipeline exec tsc --noEmit && pnpm --filter @idea/connectors exec tsc --noEmit`
Expected: No type errors.

**Step 4: Verify migration is ready**

Run: `ls -la apps/api/db/migrations/0018_bayesian_confidence.sql`
Expected: File exists.

---

## Summary

| Task | Component | New Files | Modified Files |
|------|-----------|-----------|----------------|
| 1 | DB migration | `0018_bayesian_confidence.sql` | — |
| 2 | Bayesian engine | `bayesian.ts`, `bayesian.test.ts` | — |
| 3 | Env vars (Bayesian) | — | `env.ts`, `.env.example` |
| 4 | Velocity scoring | `velocity.ts`, `velocity.test.ts` | — |
| 5 | Velocity blend | — | `blend.ts`, `scoring.test.ts` |
| 6 | npm connector | `npm_trends.ts`, `npm_trends.test.ts` | — |
| 7 | SO connector upgrade | `stackoverflow.test.ts` | `stackoverflow.ts` |
| 8 | Scholar connector | `semantic_scholar.ts`, `semantic_scholar.test.ts` | — |
| 9 | Wire connectors | — | `http.ts`, `ingest_open.ts`, `live_read_model.ts`, `connectorNames.ts` |
| 10 | Correlation scoring | `correlation.ts`, `correlation.test.ts` | — |
| 11 | Env vars (temporal) | — | `env.ts`, `.env.example` |
| 12 | Bayesian integration | — | `postgres_thesis_store.ts`, `thesis_store.ts` |
| 13 | API contract | — | `api.ts` |
| 14 | Wire posterior | — | `postgres_thesis_store.ts` |
| 15 | Final verification | — | — |

**Total:** 10 new files, 10 modified files, 15 incremental commits.
