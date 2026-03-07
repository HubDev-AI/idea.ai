# Phase 3: Self-Improving Intelligence — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make idea.ai self-improving — auto-tuning scoring weights from backtesting, building an experience library of successful predictions, routing cheap AI tasks to local Ollama models, extracting an entity-relationship knowledge graph, and visualizing a startup opportunity map.

**Architecture:** Builds on Phase 1 (Bayesian confidence, velocity) and Phase 2 (debate, backtesting, category detection, supply/demand). Adds the feedback loop (weights + experiences), efficiency layer (model routing), knowledge layer (entity graph), and visual layer (opportunity map). All additive — existing pipeline unchanged.

**Tech Stack:** TypeScript, PostgreSQL + pgvector (vector(768) already enabled), Ollama (expanded from embeddings to prompt generation), vitest, React 18

**Prerequisite:** Phase 2 complete (migrations 0021-0022 applied, backtesting running)

---

## Component A: Tiered Model Routing (Tasks 1–3)

### Task 1: Ollama Prompt Runner

**Files:**
- Create: `packages/ai-runtime/src/ollama_prompt.ts`
- Create: `packages/ai-runtime/tests/ollama_prompt.test.ts`

**Context:** Ollama is already used for embeddings (`packages/ai-runtime/src/ollama.ts` uses `POST /api/embed`). This task adds text generation via `POST /api/generate`. The existing `EmbedOptions` pattern (baseUrl, model, fetchImpl) should be mirrored.

**Step 1: Write tests**

```typescript
// packages/ai-runtime/tests/ollama_prompt.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runOllamaPrompt, type OllamaPromptOptions } from '../src/ollama_prompt';

const mockFetch = (response: string, ok = true) =>
  vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve({ response }),
  });

describe('runOllamaPrompt', () => {
  it('sends prompt to Ollama generate endpoint', async () => {
    const fetch = mockFetch('The answer is 42');
    const result = await runOllamaPrompt('What is the meaning?', {
      model: 'llama3.2:3b',
      fetchImpl: fetch,
    });
    expect(result).toBe('The answer is 42');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/generate',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"model":"llama3.2:3b"'),
      })
    );
  });

  it('uses custom baseUrl', async () => {
    const fetch = mockFetch('ok');
    await runOllamaPrompt('test', { baseUrl: 'http://gpu:11434', fetchImpl: fetch });
    expect(fetch).toHaveBeenCalledWith(
      'http://gpu:11434/api/generate',
      expect.any(Object)
    );
  });

  it('throws on non-ok response', async () => {
    const fetch = mockFetch('', false);
    await expect(runOllamaPrompt('test', { fetchImpl: fetch })).rejects.toThrow('Ollama returned 500');
  });

  it('respects timeoutMs via AbortSignal', async () => {
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {})); // never resolves
    await expect(
      runOllamaPrompt('test', { fetchImpl: fetch, timeoutMs: 50 })
    ).rejects.toThrow();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
CI=1 pnpm --dir packages/ai-runtime exec vitest run tests/ollama_prompt.test.ts
```
Expected: FAIL — module not found

**Step 3: Implement**

```typescript
// packages/ai-runtime/src/ollama_prompt.ts
export type OllamaPromptOptions = {
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export const runOllamaPrompt = async (
  prompt: string,
  options: OllamaPromptOptions = {}
): Promise<string> => {
  const model = options.model ?? 'llama3.2:3b';
  const baseUrl = options.baseUrl ?? 'http://localhost:11434';
  const timeoutMs = options.timeoutMs ?? 30_000;
  const fetchFn = options.fetchImpl ?? fetch;

  const res = await fetchFn(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = (await res.json()) as { response: string };
  return data.response;
};
```

**Step 4: Run tests — all should pass**

```bash
CI=1 pnpm --dir packages/ai-runtime exec vitest run tests/ollama_prompt.test.ts
```

**Step 5: Commit**

```bash
git add packages/ai-runtime/src/ollama_prompt.ts packages/ai-runtime/tests/ollama_prompt.test.ts
git commit -m "feat(ai-runtime): add Ollama text generation prompt runner"
```

---

### Task 2: Model Router

**Files:**
- Create: `packages/ai-runtime/src/router.ts`
- Create: `packages/ai-runtime/tests/router.test.ts`

**Context:** The router maps task names to model tiers (cheap/medium/expensive). Cheap/medium tasks go to Ollama, expensive tasks go to CLI providers (Claude/Codex). If Ollama fails and fallback is configured, it falls back to CLI.

**Step 1: Write tests**

```typescript
// packages/ai-runtime/tests/router.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createRouter, TASK_ROUTES, type RouterDeps } from '../src/router';

const makeDeps = (overrides: Partial<RouterDeps> = {}): RouterDeps => ({
  runOllama: vi.fn().mockResolvedValue('ollama result'),
  runCli: vi.fn().mockResolvedValue({ text: 'cli result', provider: 'claude', meta: {} }),
  ollamaCheapModel: 'llama3.2:3b',
  ollamaMediumModel: 'qwen2.5:7b',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaTimeoutMs: 30_000,
  ...overrides,
});

describe('createRouter', () => {
  it('routes cheap tasks to Ollama', async () => {
    const deps = makeDeps();
    const router = createRouter(deps);
    const result = await router.route('noise_classification', 'Is this signal relevant?');
    expect(deps.runOllama).toHaveBeenCalledWith('Is this signal relevant?', expect.objectContaining({ model: 'llama3.2:3b' }));
    expect(result).toBe('ollama result');
  });

  it('routes expensive tasks to CLI', async () => {
    const deps = makeDeps();
    const router = createRouter(deps);
    const result = await router.route('thesis_synthesis', 'Analyze these clusters...');
    expect(deps.runCli).toHaveBeenCalled();
    expect(result).toBe('cli result');
  });

  it('routes medium tasks to Ollama with CLI fallback', async () => {
    const deps = makeDeps({
      runOllama: vi.fn().mockRejectedValue(new Error('model not loaded')),
    });
    const router = createRouter(deps);
    const result = await router.route('basic_scoring', 'Score this signal');
    expect(deps.runOllama).toHaveBeenCalled();
    expect(deps.runCli).toHaveBeenCalled();
    expect(result).toBe('cli result');
  });

  it('throws on cheap task Ollama failure (no fallback)', async () => {
    const deps = makeDeps({
      runOllama: vi.fn().mockRejectedValue(new Error('timeout')),
    });
    const router = createRouter(deps);
    await expect(router.route('noise_classification', 'test')).rejects.toThrow('timeout');
  });

  it('routes unknown tasks to CLI', async () => {
    const deps = makeDeps();
    const router = createRouter(deps);
    const result = await router.route('unknown_task', 'test');
    expect(deps.runCli).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests to verify failure**

```bash
CI=1 pnpm --dir packages/ai-runtime exec vitest run tests/router.test.ts
```

**Step 3: Implement**

```typescript
// packages/ai-runtime/src/router.ts
import type { OllamaPromptOptions } from './ollama_prompt';
import type { RunPromptInput, RunPromptResult } from './types';

export type ModelTier = 'cheap' | 'medium' | 'expensive';

type TaskRoute = {
  tier: ModelTier;
  ollamaModel?: string;
  fallbackToCli?: boolean;
};

export const TASK_ROUTES: Record<string, TaskRoute> = {
  noise_classification: { tier: 'cheap', ollamaModel: 'cheap' },
  dedup_check: { tier: 'cheap', ollamaModel: 'cheap' },
  entity_extraction: { tier: 'cheap', ollamaModel: 'cheap' },
  basic_scoring: { tier: 'medium', ollamaModel: 'medium', fallbackToCli: true },
  thesis_synthesis: { tier: 'expensive' },
  debate: { tier: 'expensive' },
  deep_dive: { tier: 'expensive' },
};

export type RouterDeps = {
  runOllama: (prompt: string, options: OllamaPromptOptions) => Promise<string>;
  runCli: (input: RunPromptInput) => Promise<RunPromptResult>;
  ollamaCheapModel: string;
  ollamaMediumModel: string;
  ollamaBaseUrl: string;
  ollamaTimeoutMs: number;
};

export type Router = {
  route: (task: string, prompt: string) => Promise<string>;
};

export const createRouter = (deps: RouterDeps): Router => ({
  route: async (task: string, prompt: string): Promise<string> => {
    const route = TASK_ROUTES[task];
    if (!route || route.tier === 'expensive') {
      const result = await deps.runCli({ prompt });
      return result.text;
    }

    const model = route.ollamaModel === 'cheap' ? deps.ollamaCheapModel : deps.ollamaMediumModel;

    try {
      return await deps.runOllama(prompt, {
        model,
        baseUrl: deps.ollamaBaseUrl,
        timeoutMs: deps.ollamaTimeoutMs,
      });
    } catch (err) {
      if (route.fallbackToCli) {
        const result = await deps.runCli({ prompt });
        return result.text;
      }
      throw err;
    }
  },
});
```

**Step 4: Run tests**

```bash
CI=1 pnpm --dir packages/ai-runtime exec vitest run tests/router.test.ts
```

**Step 5: Commit**

```bash
git add packages/ai-runtime/src/router.ts packages/ai-runtime/tests/router.test.ts
git commit -m "feat(ai-runtime): add tiered model router for Ollama/CLI routing"
```

---

### Task 3: Env Config for Model Routing

**Files:**
- Modify: `apps/api/src/config/env.ts`
- Modify: `.env.example`

**Context:** Add routing-specific env vars. The existing pattern uses `parseNumber` for numbers and direct string access for strings.

**Step 1: Add to RuntimeEnv type** (after line 49 in env.ts)

Add these fields to the `RuntimeEnv` type:
```typescript
  modelRoutingEnabled: boolean;
  ollamaCheapModel: string;
  ollamaMediumModel: string;
  ollamaTaskTimeoutMs: number;
  weightOptEnabled: boolean;
  weightOptMinPredictions: number;
  weightOptMinImprovement: number;
  weightOptGridStep: number;
```

**Step 2: Add parsing** (in the `loadRuntimeEnv` result object)

```typescript
  modelRoutingEnabled: env.MODEL_ROUTING_ENABLED === 'true',
  ollamaCheapModel: env.OLLAMA_CHEAP_MODEL ?? 'llama3.2:3b',
  ollamaMediumModel: env.OLLAMA_MEDIUM_MODEL ?? 'qwen2.5:7b',
  ollamaTaskTimeoutMs: parseNumber(env.OLLAMA_TASK_TIMEOUT_MS, 30_000),
  weightOptEnabled: env.WEIGHT_OPT_ENABLED !== 'false',
  weightOptMinPredictions: parseNumber(env.WEIGHT_OPT_MIN_PREDICTIONS, 50),
  weightOptMinImprovement: parseNumber(env.WEIGHT_OPT_MIN_IMPROVEMENT, 0.05),
  weightOptGridStep: parseNumber(env.WEIGHT_OPT_GRID_STEP, 0.05),
```

**Step 3: Update .env.example** (add at the end)

```env
# Phase 3: Self-Improving Intelligence
MODEL_ROUTING_ENABLED=false
OLLAMA_CHEAP_MODEL=llama3.2:3b
OLLAMA_MEDIUM_MODEL=qwen2.5:7b
OLLAMA_TASK_TIMEOUT_MS=30000
WEIGHT_OPT_ENABLED=true
WEIGHT_OPT_MIN_PREDICTIONS=50
WEIGHT_OPT_MIN_IMPROVEMENT=0.05
WEIGHT_OPT_GRID_STEP=0.05
```

**Step 4: Run existing tests**

```bash
CI=1 pnpm test
```

**Step 5: Commit**

```bash
git add apps/api/src/config/env.ts .env.example
git commit -m "feat: add Phase 3 env vars for model routing and weight optimization"
```

---

## Component B: Self-Improving Signal Weights (Tasks 4–6)

### Task 4: Weight Optimizer Module

**Files:**
- Create: `packages/pipeline/src/scoring/weight_optimizer.ts`
- Create: `packages/pipeline/tests/weight_optimizer.test.ts`

**Context:** The `scoring_weight_history` table already exists (migration 0022). The current blend function at `packages/pipeline/src/scoring/blend.ts:10-11` uses hardcoded weights: `0.25 * demand + 0.20 * timing + 0.20 * buildability + 0.35 * virality`. This module does grid search over weight combinations to find the set that best predicts validated outcomes from `thesis_predictions`.

**Step 1: Write tests**

```typescript
// packages/pipeline/tests/weight_optimizer.test.ts
import { describe, expect, it } from 'vitest';
import {
  computePrecision,
  optimizeWeights,
  type ValidatedPrediction,
  type WeightConfig,
} from '../src/scoring/weight_optimizer';

const makePrediction = (
  overrides: Partial<ValidatedPrediction> = {}
): ValidatedPrediction => ({
  thesis_key: 'test:' + Math.random(),
  demand_score: 50,
  timing_score: 50,
  buildability_score: 50,
  virality_score: 50,
  velocity: 1,
  outcome_validated: false,
  ...overrides,
});

describe('computePrecision', () => {
  it('returns 1.0 when all high-scored predictions are validated', () => {
    const predictions: ValidatedPrediction[] = [
      makePrediction({ demand_score: 80, timing_score: 70, virality_score: 90, outcome_validated: true }),
      makePrediction({ demand_score: 20, timing_score: 30, virality_score: 10, outcome_validated: false }),
    ];
    const weights: WeightConfig = { demand: 0.25, timing: 0.2, buildability: 0.2, virality: 0.35 };
    const precision = computePrecision(predictions, weights, 50);
    expect(precision).toBe(1.0);
  });

  it('returns 0 when no high-scored predictions are validated', () => {
    const predictions: ValidatedPrediction[] = [
      makePrediction({ demand_score: 80, virality_score: 90, outcome_validated: false }),
    ];
    const weights: WeightConfig = { demand: 0.5, timing: 0.0, buildability: 0.0, virality: 0.5 };
    expect(computePrecision(predictions, weights, 50)).toBe(0);
  });

  it('returns NaN when no predictions above threshold', () => {
    const predictions: ValidatedPrediction[] = [
      makePrediction({ demand_score: 10, virality_score: 10, outcome_validated: true }),
    ];
    const weights: WeightConfig = { demand: 0.25, timing: 0.25, buildability: 0.25, virality: 0.25 };
    expect(Number.isNaN(computePrecision(predictions, weights, 80))).toBe(true);
  });
});

describe('optimizeWeights', () => {
  it('returns weights that maximize precision', () => {
    // All validated predictions have high demand, low virality
    const predictions: ValidatedPrediction[] = [
      makePrediction({ demand_score: 90, virality_score: 20, outcome_validated: true }),
      makePrediction({ demand_score: 85, virality_score: 15, outcome_validated: true }),
      makePrediction({ demand_score: 10, virality_score: 95, outcome_validated: false }),
      makePrediction({ demand_score: 15, virality_score: 90, outcome_validated: false }),
    ];

    const result = optimizeWeights(predictions, 0.1);
    expect(result.weights.demand).toBeGreaterThan(result.weights.virality);
    expect(result.precision).toBeGreaterThan(0.5);
  });

  it('enforces minimum weight floor of 0.05', () => {
    const predictions: ValidatedPrediction[] = Array.from({ length: 10 }, (_, i) =>
      makePrediction({
        demand_score: i < 5 ? 90 : 10,
        timing_score: 50,
        buildability_score: 50,
        virality_score: 50,
        outcome_validated: i < 5,
      })
    );

    const result = optimizeWeights(predictions, 0.05);
    expect(result.weights.demand).toBeGreaterThanOrEqual(0.05);
    expect(result.weights.timing).toBeGreaterThanOrEqual(0.05);
    expect(result.weights.buildability).toBeGreaterThanOrEqual(0.05);
    expect(result.weights.virality).toBeGreaterThanOrEqual(0.05);
  });
});
```

**Step 2: Run tests to verify failure**

```bash
CI=1 pnpm --dir packages/pipeline exec vitest run tests/weight_optimizer.test.ts
```

**Step 3: Implement**

```typescript
// packages/pipeline/src/scoring/weight_optimizer.ts
export type WeightConfig = {
  demand: number;
  timing: number;
  buildability: number;
  virality: number;
};

export type ValidatedPrediction = {
  thesis_key: string;
  demand_score: number;
  timing_score: number;
  buildability_score: number;
  virality_score: number;
  velocity: number;
  outcome_validated: boolean;
};

const blendWithWeights = (p: ValidatedPrediction, w: WeightConfig): number =>
  w.demand * p.demand_score + w.timing * p.timing_score +
  w.buildability * p.buildability_score + w.virality * p.virality_score;

export const computePrecision = (
  predictions: ValidatedPrediction[],
  weights: WeightConfig,
  threshold: number = 50
): number => {
  const predicted = predictions.filter(p => blendWithWeights(p, weights) >= threshold);
  if (predicted.length === 0) return NaN;
  const correct = predicted.filter(p => p.outcome_validated).length;
  return correct / predicted.length;
};

const range = (start: number, end: number, step: number): number[] => {
  const result: number[] = [];
  for (let v = start; v <= end + step / 10; v += step) result.push(Math.round(v * 100) / 100);
  return result;
};

const MIN_WEIGHT = 0.05;

export const optimizeWeights = (
  predictions: ValidatedPrediction[],
  gridStep: number = 0.05
): { weights: WeightConfig; precision: number } => {
  let bestWeights: WeightConfig = { demand: 0.25, timing: 0.2, buildability: 0.2, virality: 0.35 };
  let bestPrecision = -1;

  for (const demand of range(MIN_WEIGHT, 0.5, gridStep)) {
    for (const timing of range(MIN_WEIGHT, 0.4, gridStep)) {
      for (const buildability of range(MIN_WEIGHT, 0.4, gridStep)) {
        const virality = Math.round((1 - demand - timing - buildability) * 100) / 100;
        if (virality < MIN_WEIGHT || virality > 0.5) continue;

        const weights: WeightConfig = { demand, timing, buildability, virality };
        const precision = computePrecision(predictions, weights);
        if (!Number.isNaN(precision) && precision > bestPrecision) {
          bestPrecision = precision;
          bestWeights = weights;
        }
      }
    }
  }

  return { weights: bestWeights, precision: Math.max(bestPrecision, 0) };
};
```

**Step 4: Run tests**

```bash
CI=1 pnpm --dir packages/pipeline exec vitest run tests/weight_optimizer.test.ts
```

**Step 5: Commit**

```bash
git add packages/pipeline/src/scoring/weight_optimizer.ts packages/pipeline/tests/weight_optimizer.test.ts
git commit -m "feat(pipeline): add weight optimizer with grid search over validated predictions"
```

---

### Task 5: Dynamic Blend Function

**Files:**
- Modify: `packages/pipeline/src/scoring/blend.ts`
- Modify: `packages/pipeline/tests/blend.test.ts`

**Context:** Currently `blendedScore` at `packages/pipeline/src/scoring/blend.ts:10` uses hardcoded weights. Add a `blendedScoreWithWeights` function that accepts a `WeightConfig`. The existing `blendedScore` function must remain unchanged for backwards compatibility.

**Step 1: Add test for dynamic weights**

Add to existing test file (or create `packages/pipeline/tests/blend.test.ts`):

```typescript
// Add to tests
import { describe, expect, it } from 'vitest';
import { blendedScore, blendedScoreWithWeights } from '../src/scoring/blend';

describe('blendedScoreWithWeights', () => {
  it('applies custom weights', () => {
    const scores = { demand: 100, timing: 0, buildability: 0, virality: 0 };
    const weights = { demand: 1.0, timing: 0, buildability: 0, virality: 0 };
    expect(blendedScoreWithWeights(scores, weights)).toBe(100);
  });

  it('matches default blendedScore with default weights', () => {
    const scores = { demand: 80, timing: 60, buildability: 70, virality: 90 };
    const defaultWeights = { demand: 0.25, timing: 0.20, buildability: 0.20, virality: 0.35 };
    expect(blendedScoreWithWeights(scores, defaultWeights)).toBe(blendedScore(scores));
  });
});
```

**Step 2: Run test — should fail**

```bash
CI=1 pnpm --dir packages/pipeline exec vitest run tests/blend.test.ts
```

**Step 3: Add `blendedScoreWithWeights` to blend.ts**

```typescript
// Add after existing blendedScore function in blend.ts
import type { WeightConfig } from './weight_optimizer';

export const blendedScoreWithWeights = (
  scores: Scores,
  weights: WeightConfig
): number =>
  Math.round(
    (weights.demand * scores.demand +
     weights.timing * scores.timing +
     weights.buildability * scores.buildability +
     weights.virality * scores.virality) * 100
  ) / 100;
```

**Step 4: Run tests**

```bash
CI=1 pnpm --dir packages/pipeline exec vitest run tests/blend.test.ts
```

**Step 5: Commit**

```bash
git add packages/pipeline/src/scoring/blend.ts packages/pipeline/tests/blend.test.ts
git commit -m "feat(pipeline): add dynamic blendedScoreWithWeights function"
```

---

### Task 6: Weight Optimizer Job

**Files:**
- Create: `apps/api/src/jobs/weight_optimizer_job.ts`
- Create: `apps/api/tests/weight_optimizer_job.test.ts`

**Context:** This job queries `thesis_predictions` for validated results, runs grid search optimization, compares to current weights, and writes to `scoring_weight_history` if improvement exceeds the configured minimum. Scheduled monthly in main.ts (wired in Task 14).

**Step 1: Write tests**

```typescript
// apps/api/tests/weight_optimizer_job.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runWeightOptimization, type WeightOptDeps } from '../src/jobs/weight_optimizer_job';

const mockPool = () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
});

describe('runWeightOptimization', () => {
  it('skips when not enough validated predictions', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({
      rows: Array.from({ length: 10 }, () => ({
        thesis_key: 'k', demand_score: 50, timing_score: 50,
        buildability_score: 50, virality_score: 50, velocity: 1,
        outcome_validated: true,
      })),
    });

    const result = await runWeightOptimization({
      pool: pool as any,
      minPredictions: 50,
      minImprovement: 0.05,
      gridStep: 0.1,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('predictions');
  });

  it('stores new weights when improvement exceeds threshold', async () => {
    const predictions = Array.from({ length: 60 }, (_, i) => ({
      thesis_key: `k${i}`,
      demand_score: i < 30 ? 90 : 10,
      timing_score: 50,
      buildability_score: 50,
      virality_score: i < 30 ? 20 : 80,
      velocity: 1,
      outcome_validated: i < 30,
    }));

    const pool = mockPool();
    pool.query.mockResolvedValueOnce({ rows: predictions });

    const result = await runWeightOptimization({
      pool: pool as any,
      minPredictions: 50,
      minImprovement: 0.01,
      gridStep: 0.1,
    });

    expect(result.skipped).toBe(false);
    // Should have inserted into scoring_weight_history
    const insertCall = pool.query.mock.calls.find(
      (c: any) => typeof c[0] === 'string' && c[0].includes('scoring_weight_history')
    );
    expect(insertCall).toBeDefined();
  });
});
```

**Step 2: Run tests — should fail**

```bash
CI=1 pnpm --dir apps/api exec vitest run tests/weight_optimizer_job.test.ts
```

**Step 3: Implement**

```typescript
// apps/api/src/jobs/weight_optimizer_job.ts
import type { Pool } from 'pg';
import {
  optimizeWeights,
  computePrecision,
  type ValidatedPrediction,
} from '@idea/pipeline/src/scoring/weight_optimizer';

export type WeightOptDeps = {
  pool: Pool;
  minPredictions: number;
  minImprovement: number;
  gridStep: number;
};

type OptResult = {
  skipped: boolean;
  reason?: string;
  newWeights?: Record<string, number>;
  precision?: number;
  currentPrecision?: number;
};

const CURRENT_WEIGHTS = { demand: 0.25, timing: 0.20, buildability: 0.20, virality: 0.35 };

export const runWeightOptimization = async (deps: WeightOptDeps): Promise<OptResult> => {
  const { rows } = await deps.pool.query<ValidatedPrediction>(
    `SELECT thesis_key, demand_score, timing_score, buildability_score,
            virality_score, velocity, outcome_validated
     FROM thesis_predictions
     WHERE outcome_checked_at IS NOT NULL
       AND demand_score IS NOT NULL`
  );

  if (rows.length < deps.minPredictions) {
    return { skipped: true, reason: `Only ${rows.length}/${deps.minPredictions} predictions available` };
  }

  const currentPrecision = computePrecision(rows, CURRENT_WEIGHTS);
  const { weights, precision } = optimizeWeights(rows, deps.gridStep);
  const improvement = precision - (Number.isNaN(currentPrecision) ? 0 : currentPrecision);

  if (improvement < deps.minImprovement) {
    return {
      skipped: true,
      reason: `Improvement ${(improvement * 100).toFixed(1)}% below threshold ${(deps.minImprovement * 100).toFixed(1)}%`,
      currentPrecision: Number.isNaN(currentPrecision) ? undefined : currentPrecision,
      precision,
    };
  }

  await deps.pool.query(
    `INSERT INTO scoring_weight_history
       (demand_weight, timing_weight, buildability_weight, virality_weight, velocity_weight,
        precision_score, recall_score, sample_size)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [weights.demand, weights.timing, weights.buildability, weights.virality, 0,
     precision, null, rows.length]
  );

  return {
    skipped: false,
    newWeights: weights,
    precision,
    currentPrecision: Number.isNaN(currentPrecision) ? undefined : currentPrecision,
  };
};
```

**Step 4: Run tests**

```bash
CI=1 pnpm --dir apps/api exec vitest run tests/weight_optimizer_job.test.ts
```

**Step 5: Commit**

```bash
git add apps/api/src/jobs/weight_optimizer_job.ts apps/api/tests/weight_optimizer_job.test.ts
git commit -m "feat: add weight optimizer job with grid search and safety threshold"
```

---

## Component C: Experience Library (Tasks 7–9)

### Task 7: Database Migration — Experience Library

**Files:**
- Create: `apps/api/db/migrations/0023_experience_library.sql`

**Context:** Next available migration is 0023. The experience library stores successful (and failed) thesis trajectories for few-shot learning. Uses pgvector (already enabled) for embedding-based retrieval.

**Step 1: Write migration**

```sql
-- 0023_experience_library.sql
-- Experience library: stores validated thesis generation trajectories for few-shot learning

CREATE TABLE IF NOT EXISTS experience_library (
  id SERIAL PRIMARY KEY,
  thesis_key TEXT NOT NULL,
  signal_summary TEXT NOT NULL,
  reasoning_trajectory TEXT NOT NULL,
  thesis_output TEXT NOT NULL,
  outcome_validated BOOLEAN DEFAULT FALSE,
  validation_details JSONB,
  confidence_at_creation REAL,
  confidence_at_validation REAL,
  embedding VECTOR(768),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  validated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_experience_library_thesis ON experience_library(thesis_key);
CREATE INDEX IF NOT EXISTS idx_experience_library_validated ON experience_library(outcome_validated);
CREATE INDEX IF NOT EXISTS idx_experience_library_embed
  ON experience_library USING hnsw (embedding vector_cosine_ops);
```

**Step 2: Apply migration**

```bash
PGPASSWORD=idea_ai_dev psql -h 127.0.0.1 -p 5917 -U idea_ai -d idea_ai -f apps/api/db/migrations/0023_experience_library.sql
```

**Step 3: Verify**

```bash
PGPASSWORD=idea_ai_dev psql -h 127.0.0.1 -p 5917 -U idea_ai -d idea_ai -c "\d experience_library"
```

**Step 4: Commit**

```bash
git add apps/api/db/migrations/0023_experience_library.sql
git commit -m "feat: add experience_library migration (0023)"
```

---

### Task 8: Experience Store

**Files:**
- Create: `apps/api/src/runtime/experience_store.ts`
- Create: `apps/api/tests/experience_store.test.ts`

**Context:** CRUD operations for the experience library. Uses embedding similarity for retrieval (similar to how `signal_embeddings` works). The `embedText` function from `packages/ai-runtime/src/ollama.ts` is already available.

**Step 1: Write tests**

```typescript
// apps/api/tests/experience_store.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  createExperienceStore,
  type ExperienceEntry,
  type ExperienceStoreDeps,
} from '../src/runtime/experience_store';

const mockPool = () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
});

describe('ExperienceStore', () => {
  it('inserts a new experience entry', async () => {
    const pool = mockPool();
    const store = createExperienceStore({ pool: pool as any });

    await store.insert({
      thesis_key: 'consumer:test',
      signal_summary: 'HN post about X, Reddit thread about Y',
      reasoning_trajectory: 'High demand + no competitors = opportunity',
      thesis_output: 'Build an X for Y',
      confidence_at_creation: 65,
      outcome_validated: true,
      confidence_at_validation: 82,
    });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO experience_library'),
      expect.any(Array)
    );
  });

  it('retrieves top N validated experiences', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, thesis_key: 'k1', signal_summary: 's1', reasoning_trajectory: 'r1',
          thesis_output: 't1', outcome_validated: true, confidence_at_creation: 60,
          confidence_at_validation: 80 },
      ],
    });
    const store = createExperienceStore({ pool: pool as any });
    const results = await store.listValidated(5);
    expect(results).toHaveLength(1);
    expect(results[0].thesis_key).toBe('k1');
  });

  it('retrieves similar experiences by embedding', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1, thesis_key: 'k', signal_summary: 's', reasoning_trajectory: 'r',
               thesis_output: 't', outcome_validated: true, confidence_at_creation: 50,
               confidence_at_validation: 70 }],
    });
    const store = createExperienceStore({ pool: pool as any });
    const embedding = new Array(768).fill(0.1);
    const results = await store.findSimilar(embedding, 3);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY embedding <=>'),
      expect.any(Array)
    );
  });
});
```

**Step 2: Run tests — should fail**

```bash
CI=1 pnpm --dir apps/api exec vitest run tests/experience_store.test.ts
```

**Step 3: Implement**

```typescript
// apps/api/src/runtime/experience_store.ts
import type { Pool } from 'pg';

export type ExperienceEntry = {
  id?: number;
  thesis_key: string;
  signal_summary: string;
  reasoning_trajectory: string;
  thesis_output: string;
  outcome_validated: boolean;
  validation_details?: Record<string, unknown>;
  confidence_at_creation: number;
  confidence_at_validation?: number;
  embedding?: number[];
};

export type ExperienceStore = {
  insert(entry: Omit<ExperienceEntry, 'id'>): Promise<void>;
  listValidated(limit: number): Promise<ExperienceEntry[]>;
  listFailed(limit: number): Promise<ExperienceEntry[]>;
  findSimilar(embedding: number[], limit: number): Promise<ExperienceEntry[]>;
};

export type ExperienceStoreDeps = {
  pool: Pool;
};

export const createExperienceStore = (deps: ExperienceStoreDeps): ExperienceStore => ({
  async insert(entry) {
    const embeddingVal = entry.embedding
      ? `[${entry.embedding.join(',')}]`
      : null;

    await deps.pool.query(
      `INSERT INTO experience_library
         (thesis_key, signal_summary, reasoning_trajectory, thesis_output,
          outcome_validated, validation_details, confidence_at_creation,
          confidence_at_validation, embedding, validated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.thesis_key,
        entry.signal_summary,
        entry.reasoning_trajectory,
        entry.thesis_output,
        entry.outcome_validated,
        entry.validation_details ? JSON.stringify(entry.validation_details) : null,
        entry.confidence_at_creation,
        entry.confidence_at_validation ?? null,
        embeddingVal,
        entry.outcome_validated ? new Date().toISOString() : null,
      ]
    );
  },

  async listValidated(limit) {
    const { rows } = await deps.pool.query<ExperienceEntry>(
      `SELECT id, thesis_key, signal_summary, reasoning_trajectory, thesis_output,
              outcome_validated, confidence_at_creation, confidence_at_validation
       FROM experience_library
       WHERE outcome_validated = TRUE
       ORDER BY validated_at DESC
       LIMIT $1`,
      [limit]
    );
    return rows;
  },

  async listFailed(limit) {
    const { rows } = await deps.pool.query<ExperienceEntry>(
      `SELECT id, thesis_key, signal_summary, reasoning_trajectory, thesis_output,
              outcome_validated, validation_details, confidence_at_creation
       FROM experience_library
       WHERE outcome_validated = FALSE
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return rows;
  },

  async findSimilar(embedding, limit) {
    const embStr = `[${embedding.join(',')}]`;
    const { rows } = await deps.pool.query<ExperienceEntry>(
      `SELECT id, thesis_key, signal_summary, reasoning_trajectory, thesis_output,
              outcome_validated, confidence_at_creation, confidence_at_validation
       FROM experience_library
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [embStr, limit]
    );
    return rows;
  },
});
```

**Step 4: Run tests**

```bash
CI=1 pnpm --dir apps/api exec vitest run tests/experience_store.test.ts
```

**Step 5: Commit**

```bash
git add apps/api/src/runtime/experience_store.ts apps/api/tests/experience_store.test.ts
git commit -m "feat: add experience store with embedding-based similarity retrieval"
```

---

### Task 9: Experience Population from Backtest Validation

**Files:**
- Modify: `apps/api/src/jobs/backtest_validate.ts`

**Context:** When `validatePredictions` validates a prediction (finds matching signals), it should also create an experience library entry. The reasoning trajectory comes from the execution logs (the agent run that created the thesis). For now, store a simplified version: the thesis's problem statement + evidence as the trajectory.

**Step 1: Add experience population parameter to ValidationDeps**

```typescript
// In backtest_validate.ts, extend ValidationDeps:
export type ValidationDeps = {
  pool: Pool;
  searchRecentSignals: (thesisKey: string) => Promise<MatchingSignal[]>;
  validateAfterDays?: number;
  experienceStore?: {
    insert(entry: {
      thesis_key: string;
      signal_summary: string;
      reasoning_trajectory: string;
      thesis_output: string;
      confidence_at_creation: number;
      confidence_at_validation?: number;
      outcome_validated: boolean;
    }): Promise<void>;
  };
  getThesisSummary?: (thesisKey: string) => Promise<{
    title: string;
    problemStatement: string;
    evidence: string[];
    confidence: number;
  } | null>;
};
```

**Step 2: After validation, populate experience library**

In the `for` loop inside `validatePredictions`, after the UPDATE query and when `isValidated` is true:

```typescript
    if (isValidated && deps.experienceStore && deps.getThesisSummary) {
      const summary = await deps.getThesisSummary(prediction.thesis_key);
      if (summary) {
        await deps.experienceStore.insert({
          thesis_key: prediction.thesis_key,
          signal_summary: summary.evidence.slice(0, 5).join(' | '),
          reasoning_trajectory: `Problem: ${summary.problemStatement}. Evidence: ${summary.evidence.slice(0, 3).join('; ')}`,
          thesis_output: summary.title,
          confidence_at_creation: prediction.confidence_at_prediction,
          confidence_at_validation: summary.confidence,
          outcome_validated: true,
        });
      }
    }
```

**Step 3: Update existing tests** to verify experience store is called

Add to `apps/api/tests/backtest_validate.test.ts`:

```typescript
it('populates experience library on validated prediction', async () => {
  const experienceInsert = vi.fn();
  const result = await validatePredictions({
    pool: poolWithPredictions,
    searchRecentSignals: async () => [{ source: 'producthunt', canonical_text: 'launched' }],
    experienceStore: { insert: experienceInsert },
    getThesisSummary: async () => ({
      title: 'Test Thesis',
      problemStatement: 'Users need X',
      evidence: ['signal 1', 'signal 2'],
      confidence: 75,
    }),
  });
  expect(experienceInsert).toHaveBeenCalled();
});
```

**Step 4: Run tests**

```bash
CI=1 pnpm --dir apps/api exec vitest run tests/backtest_validate.test.ts
```

**Step 5: Commit**

```bash
git add apps/api/src/jobs/backtest_validate.ts apps/api/tests/backtest_validate.test.ts
git commit -m "feat: populate experience library from validated backtest predictions"
```

---

## Component D: Entity-Relationship Knowledge Graph (Tasks 10–12)

### Task 10: Database Migration — Knowledge Graph

**Files:**
- Create: `apps/api/db/migrations/0024_knowledge_graph.sql`

**Step 1: Write migration**

```sql
-- 0024_knowledge_graph.sql
-- Entity-relationship knowledge graph for multi-hop opportunity reasoning

CREATE TABLE IF NOT EXISTS entities (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('pain_point', 'technology', 'market', 'competitor', 'trend')),
  name TEXT NOT NULL,
  description TEXT,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  mention_count INTEGER DEFAULT 1,
  embedding VECTOR(768),
  UNIQUE(entity_type, name)
);

CREATE TABLE IF NOT EXISTS entity_relations (
  id SERIAL PRIMARY KEY,
  source_entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
  target_entity_id INTEGER REFERENCES entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN (
    'causes', 'enables', 'competes_with', 'addresses', 'depends_on', 'part_of'
  )),
  confidence REAL DEFAULT 0.5,
  evidence_signal_ids TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_entity_id, target_entity_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_embed ON entities USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_entity_relations_source ON entity_relations(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_relations_target ON entity_relations(target_entity_id);
```

**Step 2: Apply migration**

```bash
PGPASSWORD=idea_ai_dev psql -h 127.0.0.1 -p 5917 -U idea_ai -d idea_ai -f apps/api/db/migrations/0024_knowledge_graph.sql
```

**Step 3: Commit**

```bash
git add apps/api/db/migrations/0024_knowledge_graph.sql
git commit -m "feat: add knowledge graph migration (0024) with entities and relations"
```

---

### Task 11: Entity Store

**Files:**
- Create: `apps/api/src/runtime/entity_store.ts`
- Create: `apps/api/tests/entity_store.test.ts`

**Context:** CRUD for entities and relations. Includes graph queries for opportunity detection (unaddressed pain points, emerging technologies without products).

**Step 1: Write tests**

```typescript
// apps/api/tests/entity_store.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createEntityStore, type EntityType, type RelationType } from '../src/runtime/entity_store';

const mockPool = () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
});

describe('EntityStore', () => {
  it('upserts an entity (insert or increment count)', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const store = createEntityStore({ pool: pool as any });

    const id = await store.upsertEntity({
      entity_type: 'pain_point',
      name: 'multi-tenant DB migrations',
      description: 'Developers struggle with multi-tenant migration',
    });

    expect(id).toBe(1);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      expect.any(Array)
    );
  });

  it('upserts a relation', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const store = createEntityStore({ pool: pool as any });

    await store.upsertRelation({
      source_entity_id: 1,
      target_entity_id: 2,
      relation_type: 'addresses',
      confidence: 0.8,
      evidence_signal_ids: ['sig-123'],
    });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('entity_relations'),
      expect.any(Array)
    );
  });

  it('finds unaddressed pain points', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({
      rows: [{ name: 'agent memory', mention_count: 12 }],
    });
    const store = createEntityStore({ pool: pool as any });
    const pains = await store.findUnaddressedPains(5);
    expect(pains).toHaveLength(1);
    expect(pains[0].name).toBe('agent memory');
  });

  it('finds emerging technologies without products', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({
      rows: [{ name: 'WebGPU', mention_count: 15 }],
    });
    const store = createEntityStore({ pool: pool as any });
    const techs = await store.findEmergingTech(5);
    expect(techs).toHaveLength(1);
  });
});
```

**Step 2: Run tests — should fail**

```bash
CI=1 pnpm --dir apps/api exec vitest run tests/entity_store.test.ts
```

**Step 3: Implement**

```typescript
// apps/api/src/runtime/entity_store.ts
import type { Pool } from 'pg';

export type EntityType = 'pain_point' | 'technology' | 'market' | 'competitor' | 'trend';
export type RelationType = 'causes' | 'enables' | 'competes_with' | 'addresses' | 'depends_on' | 'part_of';

export type EntityInput = {
  entity_type: EntityType;
  name: string;
  description?: string;
  embedding?: number[];
};

export type RelationInput = {
  source_entity_id: number;
  target_entity_id: number;
  relation_type: RelationType;
  confidence?: number;
  evidence_signal_ids?: string[];
};

export type EntitySummary = {
  name: string;
  mention_count: number;
  description?: string;
};

export type EntityStore = {
  upsertEntity(input: EntityInput): Promise<number>;
  upsertRelation(input: RelationInput): Promise<void>;
  findUnaddressedPains(minMentions: number): Promise<EntitySummary[]>;
  findEmergingTech(minMentions: number): Promise<EntitySummary[]>;
  getGraphContext(entityNames: string[]): Promise<string>;
};

export const createEntityStore = (deps: { pool: Pool }): EntityStore => ({
  async upsertEntity(input) {
    const embVal = input.embedding ? `[${input.embedding.join(',')}]` : null;
    const { rows } = await deps.pool.query<{ id: number }>(
      `INSERT INTO entities (entity_type, name, description, embedding)
       VALUES ($1, $2, $3, $4::vector)
       ON CONFLICT (entity_type, name) DO UPDATE SET
         mention_count = entities.mention_count + 1,
         last_seen_at = NOW(),
         description = COALESCE(EXCLUDED.description, entities.description)
       RETURNING id`,
      [input.entity_type, input.name, input.description ?? null, embVal]
    );
    return rows[0].id;
  },

  async upsertRelation(input) {
    await deps.pool.query(
      `INSERT INTO entity_relations (source_entity_id, target_entity_id, relation_type, confidence, evidence_signal_ids)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_entity_id, target_entity_id, relation_type) DO UPDATE SET
         confidence = GREATEST(entity_relations.confidence, EXCLUDED.confidence),
         evidence_signal_ids = array_cat(entity_relations.evidence_signal_ids, EXCLUDED.evidence_signal_ids)`,
      [
        input.source_entity_id,
        input.target_entity_id,
        input.relation_type,
        input.confidence ?? 0.5,
        input.evidence_signal_ids ?? [],
      ]
    );
  },

  async findUnaddressedPains(minMentions) {
    const { rows } = await deps.pool.query<EntitySummary>(
      `SELECT p.name, p.mention_count, p.description
       FROM entities p
       LEFT JOIN entity_relations r ON r.source_entity_id = p.id AND r.relation_type = 'addresses'
       LEFT JOIN entities c ON c.id = r.target_entity_id AND c.entity_type = 'competitor'
       WHERE p.entity_type = 'pain_point'
         AND p.mention_count >= $1
         AND c.id IS NULL
       ORDER BY p.mention_count DESC
       LIMIT 20`,
      [minMentions]
    );
    return rows;
  },

  async findEmergingTech(minMentions) {
    const { rows } = await deps.pool.query<EntitySummary>(
      `SELECT t.name, t.mention_count, t.description
       FROM entities t
       WHERE t.entity_type = 'technology'
         AND t.mention_count >= $1
         AND NOT EXISTS (
           SELECT 1 FROM entity_relations r2
           JOIN entities prod ON prod.id = r2.source_entity_id
           WHERE r2.target_entity_id = t.id
             AND r2.relation_type = 'depends_on'
             AND prod.entity_type = 'competitor'
         )
       ORDER BY t.mention_count DESC
       LIMIT 20`,
      [minMentions]
    );
    return rows;
  },

  async getGraphContext(entityNames) {
    if (entityNames.length === 0) return '';
    const placeholders = entityNames.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await deps.pool.query<{
      entity_type: EntityType;
      name: string;
      mention_count: number;
      relation_type: RelationType | null;
      related_name: string | null;
      related_type: EntityType | null;
    }>(
      `SELECT e.entity_type, e.name, e.mention_count,
              r.relation_type, e2.name AS related_name, e2.entity_type AS related_type
       FROM entities e
       LEFT JOIN entity_relations r ON r.source_entity_id = e.id
       LEFT JOIN entities e2 ON e2.id = r.target_entity_id
       WHERE e.name = ANY(ARRAY[${placeholders}])
       ORDER BY e.mention_count DESC`,
      entityNames
    );

    if (rows.length === 0) return '';

    const lines: string[] = ['Related entities:'];
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.entity_type}:${row.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        lines.push(`- ${row.entity_type}: "${row.name}" (${row.mention_count} mentions)`);
      }
      if (row.related_name && row.relation_type) {
        lines.push(`  → ${row.relation_type} ${row.related_type}: "${row.related_name}"`);
      }
    }
    return lines.join('\n');
  },
});
```

**Step 4: Run tests**

```bash
CI=1 pnpm --dir apps/api exec vitest run tests/entity_store.test.ts
```

**Step 5: Commit**

```bash
git add apps/api/src/runtime/entity_store.ts apps/api/tests/entity_store.test.ts
git commit -m "feat: add entity store with graph queries for opportunity detection"
```

---

### Task 12: Entity Extractor

**Files:**
- Create: `apps/api/src/jobs/entity_extractor.ts`
- Create: `apps/api/tests/entity_extractor.test.ts`

**Context:** Uses the model router (Task 2) to extract entities from signals via Ollama cheap tier. Runs on each signal batch during the post-scrape pipeline. Parses structured JSON output and upserts entities/relations.

**Step 1: Write tests**

```typescript
// apps/api/tests/entity_extractor.test.ts
import { describe, expect, it, vi } from 'vitest';
import { extractEntities, parseEntityResponse, type EntityExtractionInput } from '../src/jobs/entity_extractor';

describe('parseEntityResponse', () => {
  it('parses valid entity extraction JSON', () => {
    const raw = JSON.stringify({
      entities: [
        { type: 'pain_point', name: 'slow deploys', description: 'Teams wait 30min for CI' },
        { type: 'technology', name: 'Docker', description: 'Container runtime' },
      ],
      relations: [
        { source: 'pain_point:slow deploys', target: 'technology:Docker', relation: 'addresses' },
      ],
    });
    const result = parseEntityResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.entities).toHaveLength(2);
    expect(result!.relations).toHaveLength(1);
  });

  it('returns null for garbage input', () => {
    expect(parseEntityResponse('not json')).toBeNull();
  });

  it('returns null for missing entities array', () => {
    expect(parseEntityResponse('{"relations": []}')).toBeNull();
  });

  it('filters out entities with invalid types', () => {
    const raw = JSON.stringify({
      entities: [
        { type: 'pain_point', name: 'valid' },
        { type: 'invalid_type', name: 'bad' },
      ],
      relations: [],
    });
    const result = parseEntityResponse(raw);
    expect(result!.entities).toHaveLength(1);
  });
});

describe('extractEntities', () => {
  it('calls router and upserts extracted entities', async () => {
    const upsertEntity = vi.fn().mockResolvedValue(1);
    const upsertRelation = vi.fn();
    const route = vi.fn().mockResolvedValue(JSON.stringify({
      entities: [{ type: 'pain_point', name: 'auth complexity' }],
      relations: [],
    }));

    await extractEntities({
      signalText: 'OAuth is too complex for indie devs',
      signalId: 'sig-1',
      route,
      entityStore: { upsertEntity, upsertRelation } as any,
    });

    expect(route).toHaveBeenCalledWith('entity_extraction', expect.any(String));
    expect(upsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({ entity_type: 'pain_point', name: 'auth complexity' })
    );
  });
});
```

**Step 2: Run tests — should fail**

```bash
CI=1 pnpm --dir apps/api exec vitest run tests/entity_extractor.test.ts
```

**Step 3: Implement**

```typescript
// apps/api/src/jobs/entity_extractor.ts
import type { EntityStore, EntityType, RelationType } from '../runtime/entity_store';

const VALID_ENTITY_TYPES = new Set<string>(['pain_point', 'technology', 'market', 'competitor', 'trend']);
const VALID_RELATION_TYPES = new Set<string>(['causes', 'enables', 'competes_with', 'addresses', 'depends_on', 'part_of']);

type RawEntity = { type: string; name: string; description?: string };
type RawRelation = { source: string; target: string; relation: string };
type ParsedResponse = { entities: RawEntity[]; relations: RawRelation[] };

export const ENTITY_EXTRACTION_PROMPT = `Extract entities from this signal. Return ONLY valid JSON:
{
  "entities": [
    {"type": "pain_point|technology|market|competitor|trend", "name": "...", "description": "..."}
  ],
  "relations": [
    {"source": "type:name", "target": "type:name", "relation": "causes|enables|competes_with|addresses|depends_on|part_of"}
  ]
}

Signal: `;

export const parseEntityResponse = (raw: string): ParsedResponse | null => {
  try {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.entities)) return null;

    const entities = parsed.entities.filter(
      (e: any) => VALID_ENTITY_TYPES.has(e.type) && typeof e.name === 'string' && e.name.length > 0
    );
    const relations = Array.isArray(parsed.relations)
      ? parsed.relations.filter(
          (r: any) => typeof r.source === 'string' && typeof r.target === 'string' && VALID_RELATION_TYPES.has(r.relation)
        )
      : [];

    return { entities, relations };
  } catch {
    return null;
  }
};

export type EntityExtractionInput = {
  signalText: string;
  signalId: string;
  route: (task: string, prompt: string) => Promise<string>;
  entityStore: Pick<EntityStore, 'upsertEntity' | 'upsertRelation'>;
};

export const extractEntities = async (input: EntityExtractionInput): Promise<number> => {
  const raw = await input.route('entity_extraction', ENTITY_EXTRACTION_PROMPT + input.signalText.slice(0, 500));
  const parsed = parseEntityResponse(raw);
  if (!parsed) return 0;

  const entityIdMap = new Map<string, number>();

  for (const entity of parsed.entities) {
    const id = await input.entityStore.upsertEntity({
      entity_type: entity.type as EntityType,
      name: entity.name.toLowerCase().trim(),
      description: entity.description,
    });
    entityIdMap.set(`${entity.type}:${entity.name}`, id);
  }

  for (const rel of parsed.relations) {
    const sourceId = entityIdMap.get(rel.source);
    const targetId = entityIdMap.get(rel.target);
    if (sourceId && targetId) {
      await input.entityStore.upsertRelation({
        source_entity_id: sourceId,
        target_entity_id: targetId,
        relation_type: rel.relation as RelationType,
        evidence_signal_ids: [input.signalId],
      });
    }
  }

  return parsed.entities.length;
};
```

**Step 4: Run tests**

```bash
CI=1 pnpm --dir apps/api exec vitest run tests/entity_extractor.test.ts
```

**Step 5: Commit**

```bash
git add apps/api/src/jobs/entity_extractor.ts apps/api/tests/entity_extractor.test.ts
git commit -m "feat: add entity extractor with LLM-powered extraction and graph upsert"
```

---

## Component E: Opportunity Map (Tasks 13–15)

### Task 13: Opportunity Map Types and API Endpoint

**Files:**
- Modify: `packages/contracts/src/api.ts`
- Create: `apps/api/src/routes/opportunity_map.ts`
- Modify: `apps/api/src/server.ts`

**Context:** Follow the existing route pattern: `registerXxxRoute(app, deps)` in `apps/api/src/server.ts`. The map is a tree of markets → categories → theses, generated on each agent run and stored in a simple JSON column (or read from the thesis store).

**Step 1: Add types to contracts**

Add to `packages/contracts/src/api.ts`:

```typescript
export type OpportunityNode = {
  id: string;
  label: string;
  type: 'market' | 'category' | 'thesis';
  confidence: number;
  velocity: number;
  supply: number;
  demand: number;
  supplyDemand?: 'opportunity' | 'competitive' | 'niche' | 'saturated' | null;
  emerging?: boolean;
  children?: OpportunityNode[];
};

export type OpportunityMapRecord = {
  roots: OpportunityNode[];
  generatedAt: string;
};
```

**Step 2: Create the route**

```typescript
// apps/api/src/routes/opportunity_map.ts
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { OpportunityMapRecord, OpportunityNode } from '@idea/contracts/src/api';

export type OpportunityMapDeps = {
  pool: Pool;
};

export const registerOpportunityMapRoute = (
  app: FastifyInstance,
  deps: OpportunityMapDeps
): void => {
  app.get('/v1/opportunity-map', async (_request, reply) => {
    const { rows } = await deps.pool.query<{
      canonical_key: string;
      title: string;
      confidence: number;
      topic: string;
      category_emerging: boolean | null;
      supply_demand: string | null;
      velocity: number | null;
      evidence_count: number;
      source_count: number;
    }>(
      `SELECT canonical_key, title, confidence, topic,
              category_emerging, supply_demand, velocity,
              evidence_count, source_count
       FROM thesis_candidates
       WHERE status != 'rejected'
       ORDER BY confidence DESC
       LIMIT 100`
    );

    // Group by topic → market hierarchy
    const topicMap = new Map<string, OpportunityNode[]>();
    for (const row of rows) {
      const topic = row.topic ?? 'Uncategorized';
      if (!topicMap.has(topic)) topicMap.set(topic, []);
      topicMap.get(topic)!.push({
        id: row.canonical_key,
        label: row.title,
        type: 'thesis',
        confidence: row.confidence,
        velocity: row.velocity ?? 0,
        supply: 0,
        demand: row.evidence_count,
        supplyDemand: row.supply_demand as OpportunityNode['supplyDemand'] ?? null,
        emerging: row.category_emerging ?? false,
      });
    }

    const roots: OpportunityNode[] = Array.from(topicMap.entries())
      .map(([topic, children]) => ({
        id: `market:${topic}`,
        label: topic,
        type: 'market' as const,
        confidence: Math.round(children.reduce((s, c) => s + c.confidence, 0) / children.length),
        velocity: Math.round(children.reduce((s, c) => s + c.velocity, 0) / children.length * 10) / 10,
        supply: 0,
        demand: children.reduce((s, c) => s + c.demand, 0),
        emerging: children.some(c => c.emerging),
        children: children.slice(0, 5),
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);

    const map: OpportunityMapRecord = {
      roots,
      generatedAt: new Date().toISOString(),
    };

    return reply.send(map);
  });
};
```

**Step 3: Register route in server.ts**

Add import at top of `apps/api/src/server.ts`:
```typescript
import { registerOpportunityMapRoute } from './routes/opportunity_map';
```

Add after the `registerInfraStatusRoute` block (around line 165):
```typescript
  if (resolvedDeps.pool) {
    registerOpportunityMapRoute(app, { pool: resolvedDeps.pool });
  }
```

Add `pool?: Pool` to `ServerDeps` type if not already there.

**Step 4: Run tests**

```bash
CI=1 pnpm test
```

**Step 5: Commit**

```bash
git add packages/contracts/src/api.ts apps/api/src/routes/opportunity_map.ts apps/api/src/server.ts
git commit -m "feat: add opportunity map API endpoint with market grouping"
```

---

### Task 14: Opportunity Map Frontend Component

**Files:**
- Create: `apps/web/src/components/OpportunityMap.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/App.tsx`

**Context:** Collapsible tree view. Node size = confidence, node color = velocity. No D3 dependency — pure CSS indentation with the existing design system. The app uses custom CSS with CSS variables (`--bg`, `--fg`, `--ok`, `--warn`, `--muted`, `--err`, `--card-bg`, `--border`).

**Step 1: Create the component**

```tsx
// apps/web/src/components/OpportunityMap.tsx
import React, { useEffect, useState } from 'react';

type OpportunityNode = {
  id: string;
  label: string;
  type: 'market' | 'category' | 'thesis';
  confidence: number;
  velocity: number;
  supply: number;
  demand: number;
  supplyDemand?: 'opportunity' | 'competitive' | 'niche' | 'saturated' | null;
  emerging?: boolean;
  children?: OpportunityNode[];
};

type OpportunityMap = {
  roots: OpportunityNode[];
  generatedAt: string;
};

const velocityColor = (v: number): string => {
  if (v >= 2) return 'var(--ok)';
  if (v >= 1) return 'var(--warn)';
  return 'var(--muted)';
};

const NodeView: React.FC<{ node: OpportunityNode; depth: number }> = ({ node, depth }) => {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div className="omap-node" style={{ paddingLeft: `${depth * 20}px` }}>
      <div
        className={`omap-row omap-type-${node.type}`}
        onClick={() => hasChildren && setExpanded(!expanded)}
        role={hasChildren ? 'button' : undefined}
        tabIndex={hasChildren ? 0 : undefined}
        onKeyDown={(e) => { if (hasChildren && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setExpanded(!expanded); } }}
      >
        {hasChildren && (
          <span className="omap-toggle">{expanded ? '\u25BC' : '\u25B6'}</span>
        )}
        <span className="omap-label">{node.label}</span>
        <span className="omap-confidence" style={{ color: velocityColor(node.velocity) }}>
          {node.confidence}%
        </span>
        {node.velocity > 0 && (
          <span className="omap-velocity" style={{ color: velocityColor(node.velocity) }}>
            {node.velocity >= 2 ? '\u2191' : node.velocity >= 1 ? '\u2197' : '\u2192'}{node.velocity.toFixed(1)}x
          </span>
        )}
        {node.supplyDemand && node.supplyDemand !== 'competitive' && (
          <span className={`omap-imbalance imbalance-${node.supplyDemand}`}>
            {node.supplyDemand}
          </span>
        )}
        {node.emerging && <span className="omap-emerging">new</span>}
        <span className="omap-demand">{node.demand} signals</span>
      </div>
      {expanded && hasChildren && (
        <div className="omap-children">
          {node.children!.map(child => (
            <NodeView key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export const OpportunityMapView: React.FC<{ apiUrl: string }> = ({ apiUrl }) => {
  const [map, setMap] = useState<OpportunityMap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${apiUrl}/v1/opportunity-map`)
      .then(res => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<OpportunityMap>;
      })
      .then(setMap)
      .catch(err => setError(err.message));
  }, [apiUrl]);

  if (error) return <div className="omap-error">Failed to load opportunity map: {error}</div>;
  if (!map) return <div className="omap-loading">Loading opportunity map...</div>;

  return (
    <div className="omap-container">
      <div className="omap-header">
        <h2>Opportunity Map</h2>
        <span className="omap-updated">{new Date(map.generatedAt).toLocaleString()}</span>
      </div>
      {map.roots.length === 0 ? (
        <p className="omap-empty">No opportunities mapped yet. Run the research agent first.</p>
      ) : (
        map.roots.map(root => <NodeView key={root.id} node={root} depth={0} />)
      )}
    </div>
  );
};
```

**Step 2: Add CSS styles**

Add to `apps/web/src/styles.css`:

```css
/* Opportunity Map */
.omap-container { padding: 16px 0; }
.omap-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }
.omap-header h2 { margin: 0; font-size: 1.1rem; }
.omap-updated { color: var(--muted); font-size: 0.8rem; }
.omap-node { margin: 2px 0; }
.omap-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-radius: 6px;
  cursor: default; font-size: 0.9rem;
  transition: background 0.15s;
}
.omap-row[role="button"] { cursor: pointer; }
.omap-row[role="button"]:hover { background: var(--card-bg); }
.omap-type-market { font-weight: 600; }
.omap-type-category { font-weight: 500; opacity: 0.9; }
.omap-type-thesis { opacity: 0.85; }
.omap-toggle { width: 14px; font-size: 0.7rem; color: var(--muted); }
.omap-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.omap-confidence { font-weight: 600; min-width: 40px; text-align: right; }
.omap-velocity { font-size: 0.8rem; min-width: 44px; }
.omap-demand { color: var(--muted); font-size: 0.8rem; min-width: 70px; text-align: right; }
.omap-imbalance { font-size: 0.7rem; padding: 1px 5px; border-radius: 4px; }
.omap-emerging { font-size: 0.7rem; padding: 1px 5px; border-radius: 4px; background: var(--ok); color: #000; }
.omap-error { color: var(--err); padding: 16px; }
.omap-loading { color: var(--muted); padding: 16px; }
.omap-empty { color: var(--muted); padding: 16px; }
.omap-children { border-left: 1px solid var(--border); margin-left: 7px; }
```

**Step 3: Wire into App.tsx**

Import and add a tab or section in the main layout. Check where the existing panes are rendered and add the map as a new pane option. Read `apps/web/src/App.tsx` to find the exact insertion point. Add it as a collapsible section below the thesis list, or as a new tab.

**Step 4: Run dev server and verify**

```bash
pnpm --dir apps/web dev
```
Open browser, verify the opportunity map renders.

**Step 5: Commit**

```bash
git add apps/web/src/components/OpportunityMap.tsx apps/web/src/styles.css apps/web/src/App.tsx
git commit -m "feat: add opportunity map tree visualization component"
```

---

## Component F: Wiring & Integration (Tasks 15–16)

### Task 15: Experience Injection into Agent Prompt

**Files:**
- Modify: `apps/api/src/jobs/research_agent.ts`

**Context:** The broad scan prompt is built in `buildBroadScanPrompt` (line 117 of research_agent.ts). After the `TREND WINDOWS` section and before `YOUR TASK`, inject experience library entries as few-shot examples.

**Step 1: Add experience context parameter to `BroadScanContext`**

In `research_agent.ts`, extend `BroadScanContext` (around line 38):

```typescript
  experienceExamples?: {
    signal_summary: string;
    reasoning_trajectory: string;
    thesis_output: string;
    outcome_validated: boolean;
  }[];
```

**Step 2: Inject into prompt**

In `buildBroadScanPrompt`, after the `TREND WINDOWS` block (around line 171), add:

```typescript
  const experienceBlock = ctx.experienceExamples && ctx.experienceExamples.length > 0
    ? [
        '',
        'VALIDATED THESIS EXAMPLES (from past successful predictions):',
        ...ctx.experienceExamples.filter(e => e.outcome_validated).map((e, i) =>
          `Example ${i + 1}:\n  Signals: ${e.signal_summary}\n  Analysis: ${e.reasoning_trajectory}\n  Result: ${e.thesis_output}\n  Outcome: Validated ✓`
        ),
        ...ctx.experienceExamples.filter(e => !e.outcome_validated).slice(0, 2).map((e, i) =>
          `Counter-example ${i + 1}:\n  Signals: ${e.signal_summary}\n  Analysis: ${e.reasoning_trajectory}\n  Result: ${e.thesis_output}\n  Outcome: Not validated — avoid similar reasoning patterns`
        ),
        '',
        'Use these examples as calibration for your confidence estimates.',
      ].join('\n')
    : '';
```

Insert `${experienceBlock}` between the trends block and the YOUR TASK section.

**Step 3: Run tests**

```bash
CI=1 pnpm --dir apps/api exec vitest run
```

**Step 4: Commit**

```bash
git add apps/api/src/jobs/research_agent.ts
git commit -m "feat: inject experience library examples into research agent prompt"
```

---

### Task 16: Wire Everything in main.ts

**Files:**
- Modify: `apps/api/src/main.ts`

**Context:** This task connects all the new components. Follow the existing patterns:
- Backtesting is wired via `setInterval` (line 464)
- Agent deps are passed to `executeAgentRun` (around line 243)

**Step 1: Import new modules**

```typescript
import { runOllamaPrompt } from '@idea/ai-runtime/src/ollama_prompt';
import { createRouter } from '@idea/ai-runtime/src/router';
import { runWeightOptimization } from './jobs/weight_optimizer_job';
import { createExperienceStore } from './runtime/experience_store';
import { createEntityStore } from './runtime/entity_store';
```

**Step 2: Initialize stores after pool creation**

After the pool is initialized (find where `const pool = ...` is created):

```typescript
const experienceStore = pool ? createExperienceStore({ pool }) : null;
const entityStore = pool ? createEntityStore({ pool }) : null;
```

**Step 3: Create model router**

```typescript
const modelRouter = runtimeEnv.modelRoutingEnabled
  ? createRouter({
      runOllama: runOllamaPrompt,
      runCli: runClaudePrompt,
      ollamaCheapModel: runtimeEnv.ollamaCheapModel,
      ollamaMediumModel: runtimeEnv.ollamaMediumModel,
      ollamaBaseUrl: runtimeEnv.ollamaBaseUrl,
      ollamaTimeoutMs: runtimeEnv.ollamaTaskTimeoutMs,
    })
  : null;
```

**Step 4: Wire experience store into backtest validation**

Update the backtest validation call (around line 469) to pass `experienceStore` and `getThesisSummary`:

```typescript
const valResult = await validatePredictions({
  pool: pool!,
  searchRecentSignals: async (thesisKey: string) => { /* existing logic */ },
  validateAfterDays: runtimeEnv.backtestValidateAfterDays,
  experienceStore: experienceStore ?? undefined,
  getThesisSummary: async (thesisKey: string) => {
    const thesis = await thesisStore.getByKey(thesisKey);
    if (!thesis) return null;
    return {
      title: thesis.title,
      problemStatement: thesis.problemStatement,
      evidence: thesis.evidence.map(e => e.snippet),
      confidence: thesis.confidence,
    };
  },
});
```

**Step 5: Add monthly weight optimization**

Add after the backtesting interval:

```typescript
if (runtimeEnv.weightOptEnabled && pool) {
  const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      const result = await runWeightOptimization({
        pool: pool!,
        minPredictions: runtimeEnv.weightOptMinPredictions,
        minImprovement: runtimeEnv.weightOptMinImprovement,
        gridStep: runtimeEnv.weightOptGridStep,
      });
      if (result.skipped) {
        console.log(`[weight-opt] Skipped: ${result.reason}`);
      } else {
        console.log(`[weight-opt] New weights: ${JSON.stringify(result.newWeights)} (precision: ${result.precision})`);
      }
    } catch (err) {
      console.error('[weight-opt] Error:', err);
    }
  }, MONTH_MS);
}
```

**Step 6: Pass experience store + entity store to agent runner deps**

In the agent deps object, add:

```typescript
experienceStore: experienceStore ?? undefined,
entityStore: entityStore ?? undefined,
modelRouter: modelRouter ?? undefined,
```

(The agent_runner will need to receive these — this is wired in the next optional enhancement step but the deps should be passed now.)

**Step 7: Pass pool to server for opportunity map**

In the `buildServer` call, add `pool` to the deps if not already present.

**Step 8: Run full test suite**

```bash
CI=1 pnpm test
```

**Step 9: Commit**

```bash
git add apps/api/src/main.ts
git commit -m "feat: wire Phase 3 components — router, experience store, entity store, weight optimizer"
```

---

## Final: Integration Test (Task 17)

### Task 17: Verify Live Integration

**Step 1: Start infrastructure**

```bash
docker compose -f docker-compose.infra.yml up -d
```

**Step 2: Apply migrations**

```bash
PGPASSWORD=idea_ai_dev psql -h 127.0.0.1 -p 5917 -U idea_ai -d idea_ai -f apps/api/db/migrations/0023_experience_library.sql
PGPASSWORD=idea_ai_dev psql -h 127.0.0.1 -p 5917 -U idea_ai -d idea_ai -f apps/api/db/migrations/0024_knowledge_graph.sql
```

**Step 3: Start API**

```bash
PORT=3001 pnpm --dir apps/api dev
```

**Step 4: Verify opportunity map endpoint**

```bash
curl -s http://127.0.0.1:3001/v1/opportunity-map | python3 -m json.tool | head -30
```

Expected: JSON tree with market groups and thesis children.

**Step 5: Check tables exist**

```bash
PGPASSWORD=idea_ai_dev psql -h 127.0.0.1 -p 5917 -U idea_ai -d idea_ai -c "\dt experience_library; \dt entities; \dt entity_relations;"
```

**Step 6: Trigger agent run and verify no regressions**

```bash
curl -s -X POST http://127.0.0.1:3001/v1/agent/run
```

Wait for completion, then check logs for errors:
```bash
tail -20 logs/executions/agent-*.jsonl | grep -i error
```

**Step 7: Run full test suite**

```bash
CI=1 pnpm test
```

Expected: All tests pass (328+ existing + ~30 new tests).

**Step 8: Final commit (if any remaining changes)**

```bash
git add -A
git commit -m "feat: Phase 3 Self-Improving Intelligence complete"
```

---

## Summary

| Task | Component | Files | New Tests |
|------|-----------|-------|-----------|
| 1 | Ollama Prompt Runner | `packages/ai-runtime/src/ollama_prompt.ts` | 4 |
| 2 | Model Router | `packages/ai-runtime/src/router.ts` | 5 |
| 3 | Env Config | `apps/api/src/config/env.ts`, `.env.example` | 0 |
| 4 | Weight Optimizer | `packages/pipeline/src/scoring/weight_optimizer.ts` | 5 |
| 5 | Dynamic Blend | `packages/pipeline/src/scoring/blend.ts` | 2 |
| 6 | Weight Optimizer Job | `apps/api/src/jobs/weight_optimizer_job.ts` | 2 |
| 7 | Experience Library Migration | `apps/api/db/migrations/0023_experience_library.sql` | 0 |
| 8 | Experience Store | `apps/api/src/runtime/experience_store.ts` | 3 |
| 9 | Experience Population | `apps/api/src/jobs/backtest_validate.ts` | 1 |
| 10 | Knowledge Graph Migration | `apps/api/db/migrations/0024_knowledge_graph.sql` | 0 |
| 11 | Entity Store | `apps/api/src/runtime/entity_store.ts` | 4 |
| 12 | Entity Extractor | `apps/api/src/jobs/entity_extractor.ts` | 4 |
| 13 | Opportunity Map API + Types | `apps/api/src/routes/opportunity_map.ts`, contracts | 0 |
| 14 | Opportunity Map Frontend | `apps/web/src/components/OpportunityMap.tsx` | 0 |
| 15 | Experience Injection | `apps/api/src/jobs/research_agent.ts` | 0 |
| 16 | Wire Everything | `apps/api/src/main.ts` | 0 |
| 17 | Integration Test | — | Live verification |

**Total: 17 tasks, ~30 new tests, 10 new files, 8 modified files**
