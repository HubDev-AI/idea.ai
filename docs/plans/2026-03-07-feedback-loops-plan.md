# Closing the Feedback Loops — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire optimized weights into actual scoring and change agent AI calls from dual-parallel to primary-with-fallback.

**Architecture:** Two independent changes. (1) `scoreSignal` in `score.ts` accepts optional `WeightConfig`; callers pass weights loaded from DB via `getActiveWeights`. (2) `dualAnalystRun` calls preferred provider first, falls back to the other only on failure, keeps all retry logic.

**Tech Stack:** TypeScript, Vitest, Fastify, PostgreSQL

---

## Item 1: Dynamic Weights in Scoring Pipeline

### Task 1: Add optional weights parameter to scoreSignal

**Files:**
- Modify: `apps/api/src/jobs/score.ts`
- Test: `apps/api/tests/score-memory.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/tests/score-memory.test.ts`:

```typescript
it('uses custom weights when provided', () => {
  const weights = { demand: 0.5, timing: 0.1, buildability: 0.1, virality: 0.3 };
  const result = scoreSignal({
    text: 'manual costly compliance process creates friction',
    judgeScores: [60, 70, 65],
    weights,
  });
  // With demand weight doubled (0.5 vs 0.25), blended score should differ from default
  const defaultResult = scoreSignal({
    text: 'manual costly compliance process creates friction',
    judgeScores: [60, 70, 65],
  });
  expect(result.blended).not.toBe(defaultResult.blended);
  expect(result.demand).toBe(defaultResult.demand); // dimension scores unchanged
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/api exec vitest run tests/score-memory.test.ts`
Expected: FAIL — `weights` is not a valid property on `ScoreSignalInput`

**Step 3: Implement**

In `apps/api/src/jobs/score.ts`:

1. Add import:
```typescript
import { blendedScore, blendedScoreWithWeights } from '@idea/pipeline/src/scoring/blend';
import type { WeightConfig } from '@idea/pipeline/src/scoring/weight_optimizer';
```

2. Add `weights` to `ScoreSignalInput`:
```typescript
export type ScoreSignalInput = {
  text: string;
  judgeScores: [number, number, number];
  memoryContext?: MemoryContext;
  baseDemand?: number;
  baseTiming?: number;
  baseVirality?: number;
  weights?: WeightConfig;
};
```

3. Update `scoreSignal` — destructure `weights` and use it:
```typescript
export const scoreSignal = ({
  text,
  judgeScores,
  memoryContext = emptyMemoryContext,
  baseDemand,
  baseTiming,
  baseVirality,
  weights
}: ScoreSignalInput) => {
  // ... (all existing dimension scoring stays the same) ...

  const virality = Number.isFinite(baseVirality) ? Math.max(0, Math.min(100, Number(baseVirality))) : 0;
  const scores = { demand, timing, buildability, virality };

  return {
    demand,
    timing,
    buildability,
    virality,
    blended: weights ? blendedScoreWithWeights(scores, weights) : blendedScore(scores),
    memory: {
      novelty,
      persistence,
      momentum,
      saturation
    }
  };
};
```

Also add `weights?` to `scoreSignalWithRetriever` params and pass through:
```typescript
export const scoreSignalWithRetriever = async ({
  // ... existing params ...
  weights
}: {
  // ... existing types ...
  weights?: WeightConfig;
}) => {
  // ... existing code ...
  const scoreInput: ScoreSignalInput = { text, judgeScores, memoryContext };
  if (baseDemand !== undefined) scoreInput.baseDemand = baseDemand;
  if (baseTiming !== undefined) scoreInput.baseTiming = baseTiming;
  if (baseVirality !== undefined) scoreInput.baseVirality = baseVirality;
  if (weights !== undefined) scoreInput.weights = weights;
  return scoreSignal(scoreInput);
};
```

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --filter @idea/api exec vitest run tests/score-memory.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/jobs/score.ts apps/api/tests/score-memory.test.ts
git -c commit.gpgsign=false commit -m "feat: accept optional weights in scoreSignal"
```

---

### Task 2: Wire dynamic weights into live_read_model.ts

**Files:**
- Modify: `apps/api/src/runtime/live_read_model.ts`

**Step 1: Add pool to createLiveReadModel opts**

At line 398, update the function signature:
```typescript
export const createLiveReadModel = (refreshMs = DEFAULT_REFRESH_MS, opts?: {
  persistentStore?: PostgresMemoryStore;
  circuit?: ProviderCircuitBreaker;
  pool?: import('pg').Pool;
}) => {
```

**Step 2: Load active weights at start of each refresh cycle**

Inside the `refresh` function, after the env is loaded and before scoring begins, add:
```typescript
import { blendedScoreWithWeights } from '@idea/pipeline/src/scoring/blend';
import type { WeightConfig } from '@idea/pipeline/src/scoring/weight_optimizer';
import { getActiveWeights } from './active_weights';
```

At the top of the file, add these imports.

Then inside the refresh function, after `const runtimeEnv = loadRuntimeEnv(process.env);`, add:
```typescript
// Load optimized weights for scoring (falls back to defaults if none exist)
let activeWeights: WeightConfig | undefined;
if (opts?.pool) {
  try {
    const aw = await getActiveWeights(opts.pool, 'consumer');
    activeWeights = { demand: aw.demand, timing: aw.timing, buildability: aw.buildability, virality: aw.virality };
  } catch { /* use default weights */ }
}
```

**Step 3: Pass weights to scoreSignalWithRetriever**

At the scoring call site (~line 703-715), add `weights` to the scoreArgs:
```typescript
const scoreArgs: Parameters<typeof scoreSignalWithRetriever>[0] = {
  text: event.text,
  judgeScores,
  topic,
  source: event.source,
  canonicalText,
  memoryRetriever: retriever,
  topK: 8,
  ...(activeWeights ? { weights: activeWeights } : {}),
};
```

**Step 4: Update the engagement-boost blendedScore recompute**

At ~line 728-730, change:
```typescript
if (eng >= 10) {
  score.blended = blendedScore(score);
}
```
to:
```typescript
if (eng >= 10) {
  score.blended = activeWeights
    ? blendedScoreWithWeights(score, activeWeights)
    : blendedScore(score);
}
```

**Step 5: Pass pool in main.ts**

In `apps/api/src/main.ts`, update the `createLiveReadModel` call (~line 61):
```typescript
const readModel = createLiveReadModel(undefined, {
  ...(memoryStore ? { persistentStore: memoryStore } : {}),
  circuit: providerCircuit,
  ...(pool ? { pool } : {}),
});
```

**Step 6: Run all tests**

Run: `CI=1 pnpm test`
Expected: All pass (no existing tests break — they don't pass weights, so they use default behavior)

**Step 7: Commit**

```bash
git add apps/api/src/runtime/live_read_model.ts apps/api/src/main.ts
git -c commit.gpgsign=false commit -m "feat: wire dynamic weights into scoring pipeline"
```

---

## Item 2: Primary-with-Fallback in Agent Runner

### Task 3: Update dualAnalystRun to sequential primary-then-fallback

**Files:**
- Modify: `packages/ai-runtime/src/dual_analyst.ts`
- Modify: `packages/ai-runtime/tests/dual-analyst.test.ts`

**Step 1: Write the failing test**

Add to `packages/ai-runtime/tests/dual-analyst.test.ts`, inside the `dualAnalystRun` describe block:

```typescript
it('calls preferred provider first and skips fallback on success', async () => {
  const runClaude = vi.fn().mockResolvedValue({
    text: JSON.stringify({ value: 1 }),
    provider: 'claude', meta: {}
  });
  const runCodex = vi.fn().mockResolvedValue({
    text: JSON.stringify({ value: 2 }),
    provider: 'codex', meta: {}
  });

  const result = await dualAnalystRun(
    { prompt: 'test', timeoutMs: 10_000 },
    { runClaude, runCodex, parseResponse: JSON.parse, preferred: 'claude' }
  );

  expect(runClaude).toHaveBeenCalledOnce();
  expect(runCodex).not.toHaveBeenCalled();
  expect(result.claude).toEqual({ value: 1 });
  expect(result.codex).toBeNull();
});

it('falls back to codex when claude fails', async () => {
  const runClaude = vi.fn().mockRejectedValue(new Error('claude down'));
  const runCodex = vi.fn().mockResolvedValue({
    text: JSON.stringify({ value: 2 }),
    provider: 'codex', meta: {}
  });

  const result = await dualAnalystRun(
    { prompt: 'test', timeoutMs: 10_000 },
    { runClaude, runCodex, parseResponse: JSON.parse, preferred: 'claude' }
  );

  expect(runClaude).toHaveBeenCalledOnce();
  expect(runCodex).toHaveBeenCalledOnce();
  expect(result.claude).toBeNull();
  expect(result.codex).toEqual({ value: 2 });
});

it('falls back to codex when claude returns unparseable response', async () => {
  const runClaude = vi.fn().mockResolvedValue({
    text: 'not json',
    provider: 'claude', meta: {}
  });
  const runCodex = vi.fn().mockResolvedValue({
    text: JSON.stringify({ value: 2 }),
    provider: 'codex', meta: {}
  });

  const result = await dualAnalystRun(
    { prompt: 'test', timeoutMs: 10_000 },
    { runClaude, runCodex, parseResponse: JSON.parse, preferred: 'claude' }
  );

  expect(runClaude).toHaveBeenCalledOnce();
  expect(runCodex).toHaveBeenCalledOnce();
  expect(result.claude).toBeNull();
  expect(result.codex).toEqual({ value: 2 });
});

it('retries when both providers fail', async () => {
  let claudeAttempts = 0;
  const runClaude = vi.fn().mockImplementation(async () => {
    claudeAttempts++;
    if (claudeAttempts <= 2) throw new Error('claude down');
    return { text: JSON.stringify({ value: 'retry' }), provider: 'claude', meta: {} };
  });
  const runCodex = vi.fn().mockRejectedValue(new Error('codex down'));

  const result = await dualAnalystRun(
    { prompt: 'test', timeoutMs: 10_000 },
    { runClaude, runCodex, parseResponse: JSON.parse, preferred: 'claude' }
  );

  // Primary (fail) -> Fallback (fail) -> Retry claude (fail) -> Retry codex (fail) -> Final claude retry (success)
  expect(result.claude).toEqual({ value: 'retry' });
});
```

**Step 2: Run tests to verify they fail**

Run: `CI=1 pnpm --filter @idea/ai-runtime exec vitest run tests/dual-analyst.test.ts`
Expected: FAIL — `preferred` is not a valid property in deps

**Step 3: Implement**

Replace the `dualAnalystRun` function body in `packages/ai-runtime/src/dual_analyst.ts`:

```typescript
export const dualAnalystRun = async <T>(
  input: RunPromptInput,
  deps: {
    runClaude: (input: RunPromptInput) => Promise<RunPromptResult>;
    runCodex: (input: RunPromptInput) => Promise<RunPromptResult>;
    parseResponse: (text: string) => T;
    logger?: { info: LogFn; warn: LogFn };
    preferred?: 'claude' | 'codex';
  }
): Promise<DualResult<T>> => {
  const log = deps.logger;
  const preferred = deps.preferred ?? 'claude';

  let claude: T | null = null;
  let codex: T | null = null;

  const runPrimary = preferred === 'claude' ? deps.runClaude : deps.runCodex;
  const runFallback = preferred === 'claude' ? deps.runCodex : deps.runClaude;
  const primaryLabel = preferred;
  const fallbackLabel = preferred === 'claude' ? 'codex' : 'claude';

  // Step 1: Try preferred provider
  try {
    const result = await runPrimary(input);
    const parsed = deps.parseResponse(result.text);
    if (preferred === 'claude') claude = parsed; else codex = parsed;
    await log?.info('dual_analyst', `${primaryLabel} succeeded`, { parsed: true });
    return { claude, codex };
  } catch (err) {
    await log?.warn('dual_analyst', `${primaryLabel} failed`, {
      error: err instanceof Error ? err.message : 'unknown'
    });
  }

  // Step 2: Try fallback provider
  try {
    const result = await runFallback(input);
    const parsed = deps.parseResponse(result.text);
    if (fallbackLabel === 'claude') claude = parsed; else codex = parsed;
    await log?.info('dual_analyst', `${fallbackLabel} succeeded`, { parsed: true });
    return { claude, codex };
  } catch (err) {
    await log?.warn('dual_analyst', `${fallbackLabel} failed`, {
      error: err instanceof Error ? err.message : 'unknown'
    });
  }

  // Step 3: Both failed — retry with existing retry logic
  // Try Claude first
  await log?.info('dual_analyst', 'both failed, retrying claude');
  try {
    const retry = await deps.runClaude(input);
    try { claude = deps.parseResponse(retry.text); } catch { /* skip */ }
    await log?.info('dual_analyst', 'claude retry result', { parsed: claude !== null });
  } catch { /* exhausted */ }

  // If Claude retry also failed, try Codex
  if (claude === null) {
    await log?.info('dual_analyst', 'claude retry failed, trying codex');
    try {
      const retry = await deps.runCodex(input);
      try { codex = deps.parseResponse(retry.text); } catch { /* skip */ }
      await log?.info('dual_analyst', 'codex retry result', { parsed: codex !== null });
    } catch { /* both retries exhausted */ }
  }

  // Final retry with Claude
  if (claude === null && codex === null) {
    try {
      const retry = await deps.runClaude(input);
      try { claude = deps.parseResponse(retry.text); } catch { /* skip */ }
    } catch { /* both attempts exhausted */ }
  }

  return { claude, codex };
};
```

**Step 4: Update existing tests**

The existing test "calls both providers and reconciles" needs updating since the new behavior is sequential. Update it:

```typescript
it('calls preferred provider first and returns without calling fallback', async () => {
  const runClaude = vi.fn().mockResolvedValue({
    text: JSON.stringify({ demand: 80, timing: 60, buildability: 70, virality: 50, reasoning: 'claude' }),
    provider: 'claude', meta: {}
  });
  const runCodex = vi.fn().mockResolvedValue({
    text: JSON.stringify({ demand: 75, timing: 65, buildability: 72, virality: 55, reasoning: 'codex' }),
    provider: 'codex', meta: {}
  });

  const result = await dualAnalystRun(
    { prompt: 'test', timeoutMs: 10_000 },
    { runClaude, runCodex, parseResponse: JSON.parse }
  );

  expect(result.claude).not.toBeNull();
  expect(result.codex).toBeNull();
  expect(runClaude).toHaveBeenCalledOnce();
  expect(runCodex).not.toHaveBeenCalled();
});
```

The existing test "handles single provider failure gracefully" should still work as-is (claude succeeds on first try when codex is passed as fallback — but claude is tried first and succeeds, so codex is never called). Actually, this test has `runCodex` rejecting, but since claude succeeds first, codex is never called. Update the test to validate the fallback path:

```typescript
it('falls back to other provider on failure', async () => {
  const runClaude = vi.fn().mockRejectedValue(new Error('claude down'));
  const runCodex = vi.fn().mockResolvedValue({
    text: JSON.stringify({ demand: 80, timing: 60, buildability: 70, virality: 50, reasoning: 'ok' }),
    provider: 'codex', meta: {}
  });

  const result = await dualAnalystRun(
    { prompt: 'test', timeoutMs: 10_000 },
    { runClaude, runCodex, parseResponse: JSON.parse }
  );

  expect(result.claude).toBeNull();
  expect(result.codex).not.toBeNull();
});
```

**Step 5: Run tests to verify they pass**

Run: `CI=1 pnpm --filter @idea/ai-runtime exec vitest run tests/dual-analyst.test.ts`
Expected: All PASS

**Step 6: Also update the integration tests**

Run: `CI=1 pnpm test`
Check `apps/api/tests/v2-integration.test.ts` — the `dualAnalystRun` tests there may also need updating since they expect both providers to be called. Update them to match the new sequential behavior.

**Step 7: Commit**

```bash
git add packages/ai-runtime/src/dual_analyst.ts packages/ai-runtime/tests/dual-analyst.test.ts
git -c commit.gpgsign=false commit -m "feat: change dualAnalystRun to primary-with-fallback"
```

---

### Task 4: Pass preferred provider through agent_runner

**Files:**
- Modify: `apps/api/src/jobs/agent_runner.ts`

**Step 1: Pass preferred to dualAnalystRun calls**

The `dualAnalystRun` calls at lines 307-319 (broad scan) and 516-528 (deep dive) need `preferred` added to deps:

For broad scan (~line 307):
```typescript
const broadResult = await dualAnalystRun<BroadScanOutput>(
  { prompt: broadPrompt, timeoutMs: timeoutMs },
  {
    runClaude: deps.runClaude,
    runCodex: deps.runCodex,
    parseResponse: (text) => {
      const parsed = parseBroadScanResponse(text);
      if (!parsed) throw new Error('Failed to parse broad scan response');
      return parsed;
    },
    preferred,
    ...(deps.logger ? { logger: deps.logger } : {})
  }
);
```

For deep dive (~line 516):
```typescript
const diveResult = await dualAnalystRun<DeepDiveOutput>(
  { prompt: divePrompt, timeoutMs: timeoutMs },
  {
    runClaude: deps.runClaude,
    runCodex: deps.runCodex,
    parseResponse: (text) => {
      const parsed = parseDeepDiveResponse(text);
      if (!parsed) throw new Error('Failed to parse deep dive response');
      return parsed;
    },
    preferred,
    ...(deps.logger ? { logger: deps.logger } : {})
  }
);
```

Note: `preferred` is already defined at line 89 as `const preferred = deps.preferredProvider ?? 'claude';`

**Step 2: Run all tests**

Run: `CI=1 pnpm test`
Expected: All pass

**Step 3: Commit**

```bash
git add apps/api/src/jobs/agent_runner.ts
git -c commit.gpgsign=false commit -m "feat: pass preferred provider to dualAnalystRun in agent runner"
```

---

### Task 5: Run full test suite and verify

**Step 1: Run all tests**

```bash
CI=1 pnpm test
```

Expected: All 378+ tests pass (may be slightly more with new tests added).

**Step 2: Verify no regressions**

Check that:
- Scoring tests in `apps/api/tests/score-memory.test.ts` pass
- Dual analyst tests in `packages/ai-runtime/tests/dual-analyst.test.ts` pass
- Integration tests in `apps/api/tests/v2-integration.test.ts` pass

If any integration tests fail due to the dual→sequential change, update their expectations to match the new behavior.
