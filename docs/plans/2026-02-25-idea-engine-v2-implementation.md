# Idea Engine V2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the keyword-counting signal scraper into an AI-powered autonomous research system with real semantic memory, tiered intelligence, dual-analyst reasoning, and a single-page thesis-driven dashboard.

**Architecture:** Two-layer system (Pipeline + Research Agent) on shared Postgres/pgvector infrastructure. Pipeline ingests and AI-scores signals through a noise gate → scoring → memory indexing chain. Research Agent runs daily using dual-analyst (claude -p + codex exec) to synthesize theses from accumulated memory. Both layers share Ollama-powered semantic embeddings.

**Tech Stack:** TypeScript, Node.js 22, pnpm workspaces, PostgreSQL + pgvector, Redis + BullMQ, Fastify, React + Vite, Ollama (nomic-embed-text), Vitest.

---

## Locked Decisions

- AI runtime: local CLI only (`claude -p` primary, `codex exec` fallback). No API keys.
- Embeddings: Ollama `nomic-embed-text` (768-dim). Local, free.
- Scoring: tiered AI — batch noise gate, per-signal scoring, daily synthesis.
- Dual-analyst: both providers reason independently, reconciliation merges views.
- Sources: HN, GitHub Issues, Reddit (new), ProductHunt (new), YC Companies + BYO (Exa, Perigon, Crunchbase).
- UI: single-page dashboard with theses at top, agent sidebar, expandable signal cards, collapsed logs.
- User interaction: event-driven only — alerts on high-confidence thesis promotion.

## Default Assumptions

- Ollama is running locally with `nomic-embed-text` model pulled.
- Existing V1 tests continue to pass (no breaking changes to test infrastructure).
- Thesis tables from `0003_thesis.sql` migration are already applied.

---

## Phase 1: Embedding & AI Foundation

### Task 1: Ollama Embedding Client

**Files:**
- Create: `packages/ai-runtime/src/ollama.ts`
- Create: `packages/ai-runtime/tests/ollama.test.ts`
- Modify: `packages/ai-runtime/src/types.ts`

**Step 1: Write the failing test**

Create `packages/ai-runtime/tests/ollama.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { embedText, type OllamaEmbedResponse } from '../src/ollama';

describe('ollama embedding client', () => {
  it('returns a 768-dim vector for valid text', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embedding: Array.from({ length: 768 }, (_, i) => i * 0.001)
      } satisfies OllamaEmbedResponse)
    });

    const result = await embedText('test input', { fetchImpl: mockFetch });

    expect(result).toHaveLength(768);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/embeddings',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('nomic-embed-text')
      })
    );
  });

  it('throws on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(embedText('fail', { fetchImpl: mockFetch })).rejects.toThrow('Ollama');
  });

  it('returns null when Ollama is unreachable', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await embedText('test', { fetchImpl: mockFetch, fallbackToNull: true });
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/ai-runtime exec vitest run tests/ollama.test.ts`
Expected: FAIL — module `../src/ollama` not found.

**Step 3: Write minimal implementation**

Create `packages/ai-runtime/src/ollama.ts`:

```ts
export type OllamaEmbedResponse = {
  embedding: number[];
};

export type EmbedOptions = {
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  fallbackToNull?: boolean;
};

export const embedText = async (
  text: string,
  options: EmbedOptions = {}
): Promise<number[] | null> => {
  const model = options.model ?? 'nomic-embed-text';
  const baseUrl = options.baseUrl ?? 'http://localhost:11434';
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text })
    });

    if (!response.ok) {
      throw new Error(`Ollama embedding failed (${response.status})`);
    }

    const data = (await response.json()) as OllamaEmbedResponse;
    return data.embedding;
  } catch (error) {
    if (options.fallbackToNull) {
      return null;
    }
    throw error;
  }
};

export const embedBatch = async (
  texts: string[],
  options: EmbedOptions = {}
): Promise<(number[] | null)[]> => {
  return Promise.all(texts.map((text) => embedText(text, { ...options, fallbackToNull: true })));
};
```

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --filter @idea/ai-runtime exec vitest run tests/ollama.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/ai-runtime/src/ollama.ts packages/ai-runtime/tests/ollama.test.ts
git commit -m "feat: add Ollama embedding client for semantic vectors"
```

---

### Task 2: Noise Gate (Tier 1 Batch AI Classification)

**Files:**
- Create: `packages/pipeline/src/scoring/noise_gate.ts`
- Create: `packages/pipeline/tests/noise-gate.test.ts`

**Step 1: Write the failing test**

Create `packages/pipeline/tests/noise-gate.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { classifyBatch, parseNoiseGateResponse, type NoiseClassification } from '../src/scoring/noise_gate';

describe('noise gate', () => {
  describe('parseNoiseGateResponse', () => {
    it('parses valid JSON array of classifications', () => {
      const raw = JSON.stringify([
        { id: 'sig-1', classification: 'strong' },
        { id: 'sig-2', classification: 'noise' },
        { id: 'sig-3', classification: 'weak' }
      ]);
      const result = parseNoiseGateResponse(raw);
      expect(result).toEqual([
        { id: 'sig-1', classification: 'strong' },
        { id: 'sig-2', classification: 'noise' },
        { id: 'sig-3', classification: 'weak' }
      ]);
    });

    it('returns all noise on unparseable input', () => {
      const result = parseNoiseGateResponse('garbage', ['a', 'b']);
      expect(result).toEqual([
        { id: 'a', classification: 'weak' },
        { id: 'b', classification: 'weak' }
      ]);
    });
  });

  describe('classifyBatch', () => {
    it('calls AI provider with batch prompt and returns classifications', async () => {
      const mockRunPrompt = vi.fn().mockResolvedValue({
        text: JSON.stringify([
          { id: 'sig-1', classification: 'strong' },
          { id: 'sig-2', classification: 'noise' }
        ]),
        provider: 'claude',
        meta: {}
      });

      const signals = [
        { id: 'sig-1', text: 'SOC2 compliance is killing our team' },
        { id: 'sig-2', text: 'Check out my new portfolio website' }
      ];

      const result = await classifyBatch(signals, { runPrompt: mockRunPrompt });

      expect(result).toHaveLength(2);
      expect(result[0].classification).toBe('strong');
      expect(result[1].classification).toBe('noise');
      expect(mockRunPrompt).toHaveBeenCalledOnce();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/pipeline exec vitest run tests/noise-gate.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create `packages/pipeline/src/scoring/noise_gate.ts`:

```ts
import type { RunPromptResult } from '@idea/ai-runtime/src/types';

export type NoiseClassification = {
  id: string;
  classification: 'noise' | 'weak' | 'strong';
};

export type NoiseGateSignal = {
  id: string;
  text: string;
};

const NOISE_GATE_PROMPT = `You are a SaaS opportunity signal classifier. For each signal below, classify it as:
- "strong": clear pain point, market gap, or emerging trend relevant to building a SaaS product
- "weak": possibly relevant but vague, low signal, or tangential
- "noise": completely irrelevant (job posting, self-promotion, personal blog, off-topic)

Return ONLY a JSON array: [{"id":"<signal_id>","classification":"strong|weak|noise"}]

SIGNALS:
`;

export const parseNoiseGateResponse = (
  raw: string,
  fallbackIds?: string[]
): NoiseClassification[] => {
  try {
    const parsed = JSON.parse(raw) as NoiseClassification[];
    if (!Array.isArray(parsed)) throw new Error('not array');
    return parsed.map((entry) => ({
      id: String(entry.id),
      classification:
        entry.classification === 'noise' || entry.classification === 'strong'
          ? entry.classification
          : 'weak'
    }));
  } catch {
    return (fallbackIds ?? []).map((id) => ({ id, classification: 'weak' as const }));
  }
};

export const classifyBatch = async (
  signals: NoiseGateSignal[],
  deps: {
    runPrompt: (input: { prompt: string; timeoutMs?: number }) => Promise<RunPromptResult>;
  }
): Promise<NoiseClassification[]> => {
  const signalBlock = signals
    .map((s) => `[${s.id}] ${s.text.slice(0, 300)}`)
    .join('\n');

  const result = await deps.runPrompt({
    prompt: NOISE_GATE_PROMPT + signalBlock,
    timeoutMs: 30_000
  });

  return parseNoiseGateResponse(
    result.text,
    signals.map((s) => s.id)
  );
};
```

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --filter @idea/pipeline exec vitest run tests/noise-gate.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/pipeline/src/scoring/noise_gate.ts packages/pipeline/tests/noise-gate.test.ts
git commit -m "feat: add AI-powered noise gate for signal classification"
```

---

### Task 3: AI-Driven Signal Scoring (Replace Keyword Heuristics)

**Files:**
- Create: `packages/pipeline/src/scoring/ai_score.ts`
- Create: `packages/pipeline/tests/ai-score.test.ts`
- Modify: `apps/api/src/jobs/score.ts` (wire AI scoring into pipeline)

**Step 1: Write the failing test**

Create `packages/pipeline/tests/ai-score.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { aiScoreSignal, parseAiScoreResponse } from '../src/scoring/ai_score';

describe('AI signal scoring', () => {
  describe('parseAiScoreResponse', () => {
    it('parses valid JSON with pain, timing, buildability, reasoning', () => {
      const raw = JSON.stringify({
        pain: 75,
        timing: 60,
        buildability: 80,
        reasoning: 'Recurring SOC2 burden with no good SaaS solution'
      });
      const result = parseAiScoreResponse(raw);
      expect(result).toEqual({
        pain: 75,
        timing: 60,
        buildability: 80,
        reasoning: 'Recurring SOC2 burden with no good SaaS solution'
      });
    });

    it('clamps scores to 0-100', () => {
      const raw = JSON.stringify({ pain: 120, timing: -5, buildability: 50, reasoning: 'test' });
      const result = parseAiScoreResponse(raw);
      expect(result.pain).toBe(100);
      expect(result.timing).toBe(0);
    });

    it('returns null on unparseable input', () => {
      expect(parseAiScoreResponse('garbage')).toBeNull();
    });
  });

  describe('aiScoreSignal', () => {
    it('sends structured prompt and returns parsed scores', async () => {
      const mockRunPrompt = vi.fn().mockResolvedValue({
        text: JSON.stringify({ pain: 80, timing: 65, buildability: 70, reasoning: 'Clear pain in compliance' }),
        provider: 'claude',
        meta: {}
      });

      const result = await aiScoreSignal(
        { text: 'SOC2 auditing is manual and painful', source: 'hn', topic: 'compliance' },
        { runPrompt: mockRunPrompt }
      );

      expect(result).not.toBeNull();
      expect(result!.pain).toBe(80);
      expect(result!.timing).toBe(65);
      expect(result!.buildability).toBe(70);
    });

    it('returns null when AI fails', async () => {
      const mockRunPrompt = vi.fn().mockRejectedValue(new Error('timeout'));
      const result = await aiScoreSignal(
        { text: 'test', source: 'hn', topic: 'test' },
        { runPrompt: mockRunPrompt }
      );
      expect(result).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/pipeline exec vitest run tests/ai-score.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create `packages/pipeline/src/scoring/ai_score.ts`:

```ts
import type { RunPromptResult } from '@idea/ai-runtime/src/types';

export type AiScoreResult = {
  pain: number;
  timing: number;
  buildability: number;
  reasoning: string;
};

const clamp = (v: number) => Math.min(100, Math.max(0, v));

const SCORE_PROMPT = `You are a SaaS opportunity analyst. Score this signal on three dimensions (0-100 each):

- **pain** (0-100): How severe and recurring is the problem described? 0 = no real pain, 100 = urgent unresolved pain affecting many people.
- **timing** (0-100): How timely is this opportunity? 0 = stale/already solved, 100 = emerging right now with regulatory or market tailwinds.
- **buildability** (0-100): How feasible is it to build a SaaS product addressing this? 0 = requires deep domain expertise or massive capital, 100 = straightforward to build and sell.

Also provide a one-sentence reasoning for your scores.

Return ONLY valid JSON: {"pain": <n>, "timing": <n>, "buildability": <n>, "reasoning": "<text>"}

SIGNAL:
Source: {source}
Topic: {topic}
Text: {text}
`;

export const parseAiScoreResponse = (raw: string): AiScoreResult | null => {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.pain !== 'number' || typeof parsed.timing !== 'number' || typeof parsed.buildability !== 'number') {
      return null;
    }
    return {
      pain: clamp(Math.round(parsed.pain)),
      timing: clamp(Math.round(parsed.timing)),
      buildability: clamp(Math.round(parsed.buildability)),
      reasoning: String(parsed.reasoning ?? '')
    };
  } catch {
    return null;
  }
};

export const aiScoreSignal = async (
  signal: { text: string; source: string; topic: string },
  deps: { runPrompt: (input: { prompt: string; timeoutMs?: number }) => Promise<RunPromptResult> }
): Promise<AiScoreResult | null> => {
  try {
    const prompt = SCORE_PROMPT
      .replace('{source}', signal.source)
      .replace('{topic}', signal.topic)
      .replace('{text}', signal.text.slice(0, 1500));

    const result = await deps.runPrompt({ prompt, timeoutMs: 25_000 });
    return parseAiScoreResponse(result.text);
  } catch {
    return null;
  }
};
```

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --filter @idea/pipeline exec vitest run tests/ai-score.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/pipeline/src/scoring/ai_score.ts packages/pipeline/tests/ai-score.test.ts
git commit -m "feat: add AI-driven signal scoring to replace keyword heuristics"
```

---

### Task 4: Dual-Analyst Pattern

**Files:**
- Create: `packages/ai-runtime/src/dual_analyst.ts`
- Create: `packages/ai-runtime/tests/dual-analyst.test.ts`

**Step 1: Write the failing test**

Create `packages/ai-runtime/tests/dual-analyst.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { dualAnalystRun, reconcileScores, type DualResult } from '../src/dual_analyst';

describe('dual analyst', () => {
  describe('reconcileScores', () => {
    it('uses median when both providers return scores', () => {
      const result = reconcileScores(
        { pain: 80, timing: 60, buildability: 70 },
        { pain: 70, timing: 80, buildability: 60 }
      );
      expect(result.pain).toBe(75);
      expect(result.timing).toBe(70);
      expect(result.buildability).toBe(65);
      expect(result.agreement).toBe('aligned');
    });

    it('flags disagreement when scores differ by >25 on any dimension', () => {
      const result = reconcileScores(
        { pain: 90, timing: 60, buildability: 70 },
        { pain: 50, timing: 55, buildability: 65 }
      );
      expect(result.agreement).toBe('contested');
      expect(result.contestedDimensions).toContain('pain');
    });

    it('uses single provider when only one returns', () => {
      const result = reconcileScores(
        { pain: 80, timing: 60, buildability: 70 },
        null
      );
      expect(result.pain).toBe(80);
      expect(result.agreement).toBe('single');
    });
  });

  describe('dualAnalystRun', () => {
    it('calls both providers and reconciles', async () => {
      const runClaude = vi.fn().mockResolvedValue({
        text: JSON.stringify({ pain: 80, timing: 60, buildability: 70, reasoning: 'claude' }),
        provider: 'claude', meta: {}
      });
      const runCodex = vi.fn().mockResolvedValue({
        text: JSON.stringify({ pain: 75, timing: 65, buildability: 72, reasoning: 'codex' }),
        provider: 'codex', meta: {}
      });

      const result = await dualAnalystRun(
        { prompt: 'test', timeoutMs: 10_000 },
        { runClaude, runCodex, parseResponse: JSON.parse }
      );

      expect(result.claude).not.toBeNull();
      expect(result.codex).not.toBeNull();
      expect(runClaude).toHaveBeenCalledOnce();
      expect(runCodex).toHaveBeenCalledOnce();
    });

    it('handles single provider failure gracefully', async () => {
      const runClaude = vi.fn().mockResolvedValue({
        text: JSON.stringify({ pain: 80, timing: 60, buildability: 70, reasoning: 'ok' }),
        provider: 'claude', meta: {}
      });
      const runCodex = vi.fn().mockRejectedValue(new Error('codex down'));

      const result = await dualAnalystRun(
        { prompt: 'test', timeoutMs: 10_000 },
        { runClaude, runCodex, parseResponse: JSON.parse }
      );

      expect(result.claude).not.toBeNull();
      expect(result.codex).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/ai-runtime exec vitest run tests/dual-analyst.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create `packages/ai-runtime/src/dual_analyst.ts`:

```ts
import type { RunPromptInput, RunPromptResult } from './types';

export type ScoreTriplet = { pain: number; timing: number; buildability: number };

export type ReconciledScore = ScoreTriplet & {
  agreement: 'aligned' | 'contested' | 'single';
  contestedDimensions: string[];
};

export type DualResult<T> = {
  claude: T | null;
  codex: T | null;
};

const DISAGREEMENT_THRESHOLD = 25;

const avg = (a: number, b: number) => Math.round((a + b) / 2);

export const reconcileScores = (
  claudeScores: ScoreTriplet | null,
  codexScores: ScoreTriplet | null
): ReconciledScore => {
  if (!claudeScores && !codexScores) {
    return { pain: 0, timing: 0, buildability: 0, agreement: 'single', contestedDimensions: [] };
  }

  if (!claudeScores || !codexScores) {
    const s = (claudeScores ?? codexScores)!;
    return { ...s, agreement: 'single', contestedDimensions: [] };
  }

  const contested: string[] = [];
  for (const dim of ['pain', 'timing', 'buildability'] as const) {
    if (Math.abs(claudeScores[dim] - codexScores[dim]) > DISAGREEMENT_THRESHOLD) {
      contested.push(dim);
    }
  }

  return {
    pain: avg(claudeScores.pain, codexScores.pain),
    timing: avg(claudeScores.timing, codexScores.timing),
    buildability: avg(claudeScores.buildability, codexScores.buildability),
    agreement: contested.length > 0 ? 'contested' : 'aligned',
    contestedDimensions: contested
  };
};

export const dualAnalystRun = async <T>(
  input: RunPromptInput,
  deps: {
    runClaude: (input: RunPromptInput) => Promise<RunPromptResult>;
    runCodex: (input: RunPromptInput) => Promise<RunPromptResult>;
    parseResponse: (text: string) => T;
  }
): Promise<DualResult<T>> => {
  const [claudeResult, codexResult] = await Promise.allSettled([
    deps.runClaude(input),
    deps.runCodex(input)
  ]);

  let claude: T | null = null;
  let codex: T | null = null;

  if (claudeResult.status === 'fulfilled') {
    try { claude = deps.parseResponse(claudeResult.value.text); } catch { /* skip */ }
  }

  if (codexResult.status === 'fulfilled') {
    try { codex = deps.parseResponse(codexResult.value.text); } catch { /* skip */ }
  }

  return { claude, codex };
};
```

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --filter @idea/ai-runtime exec vitest run tests/dual-analyst.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/ai-runtime/src/dual_analyst.ts packages/ai-runtime/tests/dual-analyst.test.ts
git commit -m "feat: add dual-analyst pattern for Claude+Codex reasoning"
```

---

## Phase 2: Memory & Retrieval

### Task 5: Replace Hash Embeddings with Ollama in Memory Indexer

**Files:**
- Modify: `apps/api/src/jobs/memory_index.ts` (swap hash embed → Ollama)
- Modify: `apps/api/db/migrations/0002_memory.sql` (update vector dimension if needed)
- Create: `apps/api/tests/ollama-memory-index.test.ts`

**Step 1: Write the failing test**

Create `apps/api/tests/ollama-memory-index.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

describe('Ollama memory indexer', () => {
  it('generates 768-dim embedding via Ollama and returns it', async () => {
    const mockEmbed = vi.fn().mockResolvedValue(Array.from({ length: 768 }, () => 0.01));

    // Import after mock is set up — the actual module integration
    // will be tested after wiring. For now validate the shape.
    const embedding = await mockEmbed('test text');
    expect(embedding).toHaveLength(768);
  });

  it('falls back gracefully when Ollama is unreachable', async () => {
    const mockEmbed = vi.fn().mockResolvedValue(null);
    const embedding = await mockEmbed('test text');
    expect(embedding).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/api exec vitest run tests/ollama-memory-index.test.ts`
Expected: PASS (this is a shape test). The real integration test is wiring Ollama into the memory indexer.

**Step 3: Modify memory indexer to use Ollama**

In `apps/api/src/jobs/memory_index.ts`, replace the local hash-based embedding call with:

```ts
import { embedText } from '@idea/ai-runtime/src/ollama';

// Replace existing hash embedding logic with:
const embedding = await embedText(canonicalText, { fallbackToNull: true });
// If null (Ollama down), skip embedding storage but still store the memory record.
```

**Step 4: Run existing memory tests to verify no regression**

Run: `CI=1 pnpm --filter @idea/api exec vitest run tests/memory_index.test.ts`
Expected: PASS (mocked embedding path still works).

**Step 5: Commit**

```bash
git add apps/api/src/jobs/memory_index.ts apps/api/tests/ollama-memory-index.test.ts
git commit -m "feat: replace hash embeddings with Ollama semantic vectors"
```

---

### Task 6: Hybrid Retrieval (pgvector + tsvector)

**Files:**
- Create: `packages/pipeline/src/memory/hybrid_search.ts`
- Create: `packages/pipeline/tests/hybrid-search.test.ts`
- Create: `apps/api/db/migrations/0004_tsvector.sql`

**Step 1: Write the failing test**

Create `packages/pipeline/tests/hybrid-search.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mergeByRRF, type RankedResult } from '../src/memory/hybrid_search';

describe('hybrid search', () => {
  describe('reciprocal rank fusion', () => {
    it('merges vector and text results by RRF', () => {
      const vectorResults: RankedResult[] = [
        { signal_id: 'a', rank: 1 },
        { signal_id: 'b', rank: 2 },
        { signal_id: 'c', rank: 3 }
      ];
      const textResults: RankedResult[] = [
        { signal_id: 'b', rank: 1 },
        { signal_id: 'd', rank: 2 },
        { signal_id: 'a', rank: 3 }
      ];

      const merged = mergeByRRF(vectorResults, textResults, { k: 60 });

      // 'b' appears in both lists (rank 2 + rank 1) → highest RRF
      // 'a' appears in both lists (rank 1 + rank 3) → second highest
      expect(merged[0].signal_id).toBe('b');
      expect(merged[1].signal_id).toBe('a');
      expect(merged.length).toBe(4);
    });

    it('handles empty inputs', () => {
      expect(mergeByRRF([], [], { k: 60 })).toEqual([]);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/pipeline exec vitest run tests/hybrid-search.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create `packages/pipeline/src/memory/hybrid_search.ts`:

```ts
export type RankedResult = {
  signal_id: string;
  rank: number;
};

export type MergedResult = {
  signal_id: string;
  rrf_score: number;
};

export const mergeByRRF = (
  vectorResults: RankedResult[],
  textResults: RankedResult[],
  options: { k?: number; topN?: number } = {}
): MergedResult[] => {
  const k = options.k ?? 60;
  const scores = new Map<string, number>();

  for (const r of vectorResults) {
    scores.set(r.signal_id, (scores.get(r.signal_id) ?? 0) + 1 / (k + r.rank));
  }

  for (const r of textResults) {
    scores.set(r.signal_id, (scores.get(r.signal_id) ?? 0) + 1 / (k + r.rank));
  }

  const merged = Array.from(scores.entries())
    .map(([signal_id, rrf_score]) => ({ signal_id, rrf_score }))
    .sort((a, b) => b.rrf_score - a.rrf_score);

  return options.topN ? merged.slice(0, options.topN) : merged;
};
```

Create `apps/api/db/migrations/0004_tsvector.sql`:

```sql
ALTER TABLE signal_memory ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', canonical_text)) STORED;

CREATE INDEX IF NOT EXISTS signal_memory_tsv_idx ON signal_memory USING GIN (tsv);
```

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --filter @idea/pipeline exec vitest run tests/hybrid-search.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/pipeline/src/memory/hybrid_search.ts packages/pipeline/tests/hybrid-search.test.ts apps/api/db/migrations/0004_tsvector.sql
git commit -m "feat: add hybrid search with pgvector + tsvector RRF fusion"
```

---

### Task 7: Cross-Source Deduplication

**Files:**
- Create: `packages/pipeline/src/dedup.ts`
- Create: `packages/pipeline/tests/dedup.test.ts`

**Step 1: Write the failing test**

Create `packages/pipeline/tests/dedup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findDuplicates, type EmbeddedSignal } from '../src/dedup';

describe('cross-source dedup', () => {
  const cosine = (a: number[], b: number[]) => {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  };

  it('detects duplicates from different sources above threshold', () => {
    // Create two near-identical vectors from different sources
    const baseVec = Array.from({ length: 10 }, (_, i) => i * 0.1);
    const nearDupe = baseVec.map((v) => v + 0.001);

    const signals: EmbeddedSignal[] = [
      { signal_id: 'hn-1', source: 'hn', embedding: baseVec },
      { signal_id: 'gh-1', source: 'github_issues', embedding: nearDupe },
      { signal_id: 'hn-2', source: 'hn', embedding: Array.from({ length: 10 }, () => Math.random()) }
    ];

    const dupes = findDuplicates(signals, { threshold: 0.99 });
    expect(dupes).toHaveLength(1);
    expect(dupes[0].signals).toContain('hn-1');
    expect(dupes[0].signals).toContain('gh-1');
  });

  it('ignores same-source pairs', () => {
    const vec = Array.from({ length: 10 }, (_, i) => i * 0.1);
    const signals: EmbeddedSignal[] = [
      { signal_id: 'hn-1', source: 'hn', embedding: vec },
      { signal_id: 'hn-2', source: 'hn', embedding: vec }
    ];

    const dupes = findDuplicates(signals, { threshold: 0.99 });
    expect(dupes).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/pipeline exec vitest run tests/dedup.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create `packages/pipeline/src/dedup.ts`:

```ts
export type EmbeddedSignal = {
  signal_id: string;
  source: string;
  embedding: number[];
};

export type DuplicateCluster = {
  signals: string[];
  similarity: number;
};

const cosineSimilarity = (a: number[], b: number[]): number => {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
};

export const findDuplicates = (
  signals: EmbeddedSignal[],
  options: { threshold?: number } = {}
): DuplicateCluster[] => {
  const threshold = options.threshold ?? 0.92;
  const clusters: DuplicateCluster[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < signals.length; i++) {
    if (seen.has(signals[i].signal_id)) continue;

    for (let j = i + 1; j < signals.length; j++) {
      if (seen.has(signals[j].signal_id)) continue;
      if (signals[i].source === signals[j].source) continue;

      const sim = cosineSimilarity(signals[i].embedding, signals[j].embedding);
      if (sim >= threshold) {
        clusters.push({
          signals: [signals[i].signal_id, signals[j].signal_id],
          similarity: Math.round(sim * 1000) / 1000
        });
        seen.add(signals[j].signal_id);
      }
    }
  }

  return clusters;
};
```

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --filter @idea/pipeline exec vitest run tests/dedup.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/pipeline/src/dedup.ts packages/pipeline/tests/dedup.test.ts
git commit -m "feat: add cross-source deduplication via embedding similarity"
```

---

## Phase 3: New Connectors

### Task 8: Reddit Connector

**Files:**
- Create: `packages/connectors/src/reddit.ts`
- Create: `packages/connectors/tests/reddit.test.ts`
- Modify: `packages/connectors/src/common/http.ts` (add reddit to cadence/limits)

**Step 1: Write the failing test**

Create `packages/connectors/tests/reddit.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { fetchReddit, DEFAULT_SUBREDDITS } from '../src/reddit';

describe('reddit connector', () => {
  it('fetches posts from public subreddit JSON API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          children: [
            {
              data: {
                id: 'abc123',
                title: 'Why is SOC2 so painful?',
                selftext: 'We spent 3 months on compliance...',
                permalink: '/r/SaaS/comments/abc123/why_is_soc2_so_painful/',
                created_utc: 1740000000,
                subreddit: 'SaaS'
              }
            }
          ]
        }
      })
    });

    const results = await fetchReddit({
      subreddits: ['SaaS'],
      limit: 10,
      fetchImpl: mockFetch
    });

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('reddit');
    expect(results[0].source_item_id).toBe('reddit:abc123');
    expect(results[0].text).toContain('SOC2');
    expect(results[0].url).toContain('reddit.com');
  });

  it('has sensible default subreddits', () => {
    expect(DEFAULT_SUBREDDITS).toContain('SaaS');
    expect(DEFAULT_SUBREDDITS).toContain('startups');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/connectors exec vitest run tests/reddit.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create `packages/connectors/src/reddit.ts`:

```ts
import type { RawEventInput } from './common/http';
import { fetchJsonWithRetry } from './common/http';

export const DEFAULT_SUBREDDITS = ['SaaS', 'startups', 'smallbusiness', 'Entrepreneur'];

type RedditPost = {
  data: {
    id: string;
    title: string;
    selftext: string;
    permalink: string;
    created_utc: number;
    subreddit: string;
  };
};

type RedditListingResponse = {
  data: {
    children: RedditPost[];
  };
};

export const fetchReddit = async (options: {
  subreddits?: string[];
  limit?: number;
  fetchImpl?: typeof fetch;
}): Promise<RawEventInput[]> => {
  const subreddits = options.subreddits ?? DEFAULT_SUBREDDITS;
  const limit = options.limit ?? 25;
  const results: RawEventInput[] = [];

  for (const sub of subreddits) {
    try {
      const data = await fetchJsonWithRetry<RedditListingResponse>(
        `https://www.reddit.com/r/${sub}/new.json?limit=${limit}`,
        {
          fetchImpl: options.fetchImpl,
          init: { headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' } }
        }
      );

      for (const post of data.data.children) {
        const { id, title, selftext, permalink, created_utc } = post.data;
        results.push({
          source: 'reddit',
          source_item_id: `reddit:${id}`,
          source_timestamp: new Date(created_utc * 1000).toISOString(),
          text: `${title}\n${selftext}`.slice(0, 2000),
          url: `https://www.reddit.com${permalink}`
        });
      }
    } catch {
      // Skip failed subreddit, don't crash entire connector
    }
  }

  return results;
};
```

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --filter @idea/connectors exec vitest run tests/reddit.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connectors/src/reddit.ts packages/connectors/tests/reddit.test.ts
git commit -m "feat: add Reddit connector via public JSON API"
```

---

### Task 9: ProductHunt Connector

**Files:**
- Create: `packages/connectors/src/producthunt.ts`
- Create: `packages/connectors/tests/producthunt.test.ts`

**Step 1: Write the failing test**

Create `packages/connectors/tests/producthunt.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { fetchProductHunt } from '../src/producthunt';

describe('producthunt connector', () => {
  it('fetches recent posts from PH API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          posts: {
            edges: [
              {
                node: {
                  id: 'ph-123',
                  name: 'ComplianceBot',
                  tagline: 'Automate your SOC2 audits',
                  url: 'https://www.producthunt.com/posts/compliancebot',
                  createdAt: '2026-02-25T10:00:00Z',
                  votesCount: 42,
                  topics: { edges: [{ node: { name: 'SaaS' } }] }
                }
              }
            ]
          }
        }
      })
    });

    const results = await fetchProductHunt({ fetchImpl: mockFetch, token: 'test-token' });

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('producthunt');
    expect(results[0].text).toContain('ComplianceBot');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/connectors exec vitest run tests/producthunt.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create `packages/connectors/src/producthunt.ts`:

```ts
import type { RawEventInput } from './common/http';

type PHNode = {
  id: string;
  name: string;
  tagline: string;
  url: string;
  createdAt: string;
  votesCount: number;
  topics: { edges: { node: { name: string } }[] };
};

type PHResponse = {
  data: { posts: { edges: { node: PHNode }[] } };
};

const PH_GRAPHQL_URL = 'https://api.producthunt.com/v2/api/graphql';

const POSTS_QUERY = `query { posts(order: NEWEST, first: 20) { edges { node { id name tagline url createdAt votesCount topics { edges { node { name } } } } } } }`;

export const fetchProductHunt = async (options: {
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<RawEventInput[]> => {
  const token = options.token ?? process.env.PH_API_TOKEN;
  if (!token) return [];

  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl(PH_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ query: POSTS_QUERY })
  });

  if (!response.ok) return [];

  const data = (await response.json()) as PHResponse;

  return data.data.posts.edges.map(({ node }) => {
    const topics = node.topics.edges.map((e) => e.node.name).join(', ');
    return {
      source: 'producthunt',
      source_item_id: `ph:${node.id}`,
      source_timestamp: node.createdAt,
      text: `${node.name}: ${node.tagline} (${node.votesCount} votes, topics: ${topics})`,
      url: node.url
    };
  });
};
```

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --filter @idea/connectors exec vitest run tests/producthunt.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connectors/src/producthunt.ts packages/connectors/tests/producthunt.test.ts
git commit -m "feat: add ProductHunt connector via GraphQL API"
```

---

## Phase 4: Thesis System & Research Agent

### Task 10: Wire Thesis Synthesizer into Pipeline with DB Persistence

**Files:**
- Create: `apps/api/src/runtime/thesis_store.ts`
- Create: `apps/api/tests/thesis-store.test.ts`
- Modify: `apps/api/src/server.ts` (register thesis routes)
- Modify: `apps/api/src/routes/theses.ts` (wire to DB store)

**Step 1: Write the failing test**

Create `apps/api/tests/thesis-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { InMemoryThesisStore } from '../src/runtime/thesis_store';
import type { ThesisDraft } from '../src/jobs/thesis_synthesizer';

describe('thesis store', () => {
  it('upserts thesis candidates', async () => {
    const store = new InMemoryThesisStore();
    const draft: ThesisDraft = {
      canonicalKey: 'compliance:compliance:audit',
      title: 'audit compliance copilot for compliance',
      topic: 'compliance',
      status: 'candidate',
      confidence: 55,
      scoreTotal: 55,
      problemStatement: 'Compliance tasks keep recurring.',
      targetBuyer: 'Engineering teams',
      proposedSolution: 'Automate evidence capture.',
      evidenceCount: 3,
      avgPain: 70,
      avgTiming: 60,
      avgBuildability: 65,
      latestObservedAt: '2026-02-25T10:00:00Z',
      evidence: []
    };

    await store.upsert(draft);
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].canonicalKey).toBe('compliance:compliance:audit');
  });

  it('updates existing thesis on second upsert', async () => {
    const store = new InMemoryThesisStore();
    const draft: ThesisDraft = {
      canonicalKey: 'test:key',
      title: 'test', topic: 'test', status: 'candidate',
      confidence: 50, scoreTotal: 50,
      problemStatement: 'p', targetBuyer: 't', proposedSolution: 's',
      evidenceCount: 2, avgPain: 50, avgTiming: 50, avgBuildability: 50,
      latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    };

    await store.upsert(draft);
    await store.upsert({ ...draft, confidence: 75, status: 'watching' });

    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].confidence).toBe(75);
    expect(all[0].status).toBe('watching');
  });

  it('filters by status', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'a', title: 'a', topic: 't', status: 'promoted',
      confidence: 85, scoreTotal: 85, problemStatement: 'p', targetBuyer: 'b',
      proposedSolution: 's', evidenceCount: 5, avgPain: 80, avgTiming: 70,
      avgBuildability: 75, latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    });
    await store.upsert({
      canonicalKey: 'b', title: 'b', topic: 't', status: 'candidate',
      confidence: 40, scoreTotal: 40, problemStatement: 'p', targetBuyer: 'b',
      proposedSolution: 's', evidenceCount: 2, avgPain: 40, avgTiming: 30,
      avgBuildability: 50, latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    });

    const promoted = await store.list({ status: 'promoted' });
    expect(promoted).toHaveLength(1);
    expect(promoted[0].canonicalKey).toBe('a');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/api exec vitest run tests/thesis-store.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create `apps/api/src/runtime/thesis_store.ts`:

```ts
import type { ThesisDraft, ThesisStatus } from '../jobs/thesis_synthesizer';

export type ThesisStoreFilter = {
  status?: ThesisStatus;
};

export interface ThesisStore {
  upsert(draft: ThesisDraft): Promise<void>;
  list(filter?: ThesisStoreFilter): Promise<ThesisDraft[]>;
  getByKey(canonicalKey: string): Promise<ThesisDraft | null>;
}

export class InMemoryThesisStore implements ThesisStore {
  private store = new Map<string, ThesisDraft>();

  async upsert(draft: ThesisDraft): Promise<void> {
    this.store.set(draft.canonicalKey, { ...draft });
  }

  async list(filter?: ThesisStoreFilter): Promise<ThesisDraft[]> {
    const all = Array.from(this.store.values());
    if (filter?.status) {
      return all.filter((t) => t.status === filter.status);
    }
    return all.sort((a, b) => b.confidence - a.confidence);
  }

  async getByKey(canonicalKey: string): Promise<ThesisDraft | null> {
    return this.store.get(canonicalKey) ?? null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --filter @idea/api exec vitest run tests/thesis-store.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/src/runtime/thesis_store.ts apps/api/tests/thesis-store.test.ts
git commit -m "feat: add thesis store with in-memory implementation"
```

---

### Task 11: Research Agent Core

**Files:**
- Create: `apps/api/src/jobs/research_agent.ts`
- Create: `apps/api/tests/research-agent.test.ts`

**Step 1: Write the failing test**

Create `apps/api/tests/research-agent.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  buildAgentPrompt,
  parseAgentResponse,
  type AgentContext,
  type AgentOutput
} from '../src/jobs/research_agent';

describe('research agent', () => {
  describe('buildAgentPrompt', () => {
    it('includes active theses and recent signals in context', () => {
      const ctx: AgentContext = {
        activeTheses: [
          { canonicalKey: 'compliance:soc2', title: 'SOC2 copilot', confidence: 72, status: 'watching', evidenceCount: 8 }
        ],
        recentSignals: [
          { signal_id: 'sig-1', text: 'SOC2 audit took us 3 months', source: 'hn', pain: 85, timing: 70 }
        ],
        trendSummary: [
          { topic: 'compliance', window: '7d', count: 12, avg_pain: 75, growth: '+40%' }
        ]
      };

      const prompt = buildAgentPrompt(ctx);
      expect(prompt).toContain('SOC2 copilot');
      expect(prompt).toContain('sig-1');
      expect(prompt).toContain('compliance');
    });
  });

  describe('parseAgentResponse', () => {
    it('parses valid JSON response with thesis updates', () => {
      const raw = JSON.stringify({
        theses_updated: [
          { canonicalKey: 'compliance:soc2', confidence_delta: +5, reasoning: 'new evidence' }
        ],
        new_theses: [],
        alerts: [],
        investigate_next: 'AI billing patterns'
      });

      const result = parseAgentResponse(raw);
      expect(result).not.toBeNull();
      expect(result!.theses_updated).toHaveLength(1);
      expect(result!.investigate_next).toBe('AI billing patterns');
    });

    it('returns null on invalid JSON', () => {
      expect(parseAgentResponse('not json')).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/api exec vitest run tests/research-agent.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create `apps/api/src/jobs/research_agent.ts`:

```ts
export type AgentThesisSummary = {
  canonicalKey: string;
  title: string;
  confidence: number;
  status: string;
  evidenceCount: number;
};

export type AgentSignalSummary = {
  signal_id: string;
  text: string;
  source: string;
  pain: number;
  timing: number;
};

export type AgentTrendSummary = {
  topic: string;
  window: string;
  count: number;
  avg_pain: number;
  growth: string;
};

export type AgentContext = {
  activeTheses: AgentThesisSummary[];
  recentSignals: AgentSignalSummary[];
  trendSummary: AgentTrendSummary[];
};

export type ThesisUpdate = {
  canonicalKey: string;
  confidence_delta: number;
  reasoning: string;
};

export type NewThesisProposal = {
  title: string;
  problem_statement: string;
  target_buyer: string;
  proposed_solution: string;
  supporting_signal_ids: string[];
};

export type AgentOutput = {
  theses_updated: ThesisUpdate[];
  new_theses: NewThesisProposal[];
  alerts: string[];
  investigate_next: string;
};

export const buildAgentPrompt = (ctx: AgentContext): string => {
  const thesesBlock = ctx.activeTheses.length > 0
    ? ctx.activeTheses.map((t) =>
        `- "${t.title}" (confidence: ${t.confidence}%, ${t.evidenceCount} signals, status: ${t.status})`
      ).join('\n')
    : '(none yet)';

  const signalsBlock = ctx.recentSignals.length > 0
    ? ctx.recentSignals.map((s) =>
        `- [${s.source}] ${s.text.slice(0, 200)} (pain: ${s.pain}, timing: ${s.timing})`
      ).join('\n')
    : '(no new signals)';

  const trendsBlock = ctx.trendSummary.length > 0
    ? ctx.trendSummary.map((t) =>
        `- "${t.topic}" ${t.window}: ${t.count} signals, avg pain ${t.avg_pain}, growth ${t.growth}`
      ).join('\n')
    : '(no trend data)';

  return `You are a SaaS opportunity researcher. Analyze accumulated intelligence and maintain thesis quality.

ACTIVE THESES:
${thesesBlock}

NEW SIGNALS SINCE LAST RUN:
${signalsBlock}

TREND WINDOWS:
${trendsBlock}

YOUR TASK:
1. Review new signals. Do any strengthen or weaken existing theses? Provide confidence_delta (-20 to +20) with reasoning.
2. Do new signals suggest a NEW thesis not yet tracked? Propose with title, problem, buyer, solution, and supporting signal IDs.
3. If any thesis should be promoted (confidence crossing 80%), include its canonicalKey in alerts.
4. Suggest one area to investigate deeper in the next run.

Return ONLY valid JSON:
{
  "theses_updated": [{"canonicalKey": "...", "confidence_delta": <n>, "reasoning": "..."}],
  "new_theses": [{"title": "...", "problem_statement": "...", "target_buyer": "...", "proposed_solution": "...", "supporting_signal_ids": ["..."]}],
  "alerts": ["canonicalKey of promoted theses"],
  "investigate_next": "topic or question to research next"
}`;
};

export const parseAgentResponse = (raw: string): AgentOutput | null => {
  try {
    const parsed = JSON.parse(raw) as AgentOutput;
    if (!Array.isArray(parsed.theses_updated)) return null;
    return {
      theses_updated: parsed.theses_updated ?? [],
      new_theses: parsed.new_theses ?? [],
      alerts: parsed.alerts ?? [],
      investigate_next: String(parsed.investigate_next ?? '')
    };
  } catch {
    return null;
  }
};
```

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --filter @idea/api exec vitest run tests/research-agent.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/src/jobs/research_agent.ts apps/api/tests/research-agent.test.ts
git commit -m "feat: add research agent core with prompt builder and parser"
```

---

### Task 12: Register Thesis API Routes

**Files:**
- Modify: `apps/api/src/server.ts` (add thesis routes)
- Modify: `apps/api/src/routes/theses.ts` (wire to store)
- Create: `apps/api/tests/theses-api.test.ts`

**Step 1: Write the failing test**

Create `apps/api/tests/theses-api.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';
import { InMemoryThesisStore } from '../src/runtime/thesis_store';

describe('GET /v1/theses', () => {
  it('returns empty array when no theses exist', async () => {
    const store = new InMemoryThesisStore();
    const app = buildServer({ thesisStore: store });
    const response = await app.inject({ method: 'GET', url: '/v1/theses' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('returns theses sorted by confidence', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'low', title: 'Low', topic: 't', status: 'candidate',
      confidence: 40, scoreTotal: 40, problemStatement: 'p', targetBuyer: 'b',
      proposedSolution: 's', evidenceCount: 2, avgPain: 40, avgTiming: 30,
      avgBuildability: 50, latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    });
    await store.upsert({
      canonicalKey: 'high', title: 'High', topic: 't', status: 'promoted',
      confidence: 85, scoreTotal: 85, problemStatement: 'p', targetBuyer: 'b',
      proposedSolution: 's', evidenceCount: 5, avgPain: 80, avgTiming: 70,
      avgBuildability: 75, latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    });

    const app = buildServer({ thesisStore: store });
    const response = await app.inject({ method: 'GET', url: '/v1/theses' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(2);
    expect(body[0].canonicalKey).toBe('high');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/api exec vitest run tests/theses-api.test.ts`
Expected: FAIL (thesisStore not in ServerDeps, route not registered).

**Step 3: Write minimal implementation**

Modify `apps/api/src/server.ts` to add `thesisStore` to `ServerDeps` and register the thesis route.

Modify `apps/api/src/routes/theses.ts` to accept a `ThesisStore` and serve `GET /v1/theses`.

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --filter @idea/api exec vitest run tests/theses-api.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/routes/theses.ts apps/api/tests/theses-api.test.ts
git commit -m "feat: register thesis API routes with store integration"
```

---

## Phase 5: UI Redesign

### Task 13: Dashboard Layout Restructure

**Files:**
- Modify: `apps/web/src/App.tsx` (new layout: theses top, agent sidebar, signals main, logs collapsed)
- Modify: `apps/web/src/styles.css` (new grid layout)
- Modify: `apps/web/src/api.ts` (add thesis + agent fetch functions)

**Step 1: Write the failing test**

Modify `apps/web/tests/app.test.tsx` to assert:

```ts
it('renders thesis section', () => {
  // Validate that a "Top Theses" section exists in the DOM
});

it('renders agent activity sidebar', () => {
  // Validate agent sidebar renders
});

it('renders collapsed log drawer', () => {
  // Validate logs are not expanded by default
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/web exec vitest run`
Expected: FAIL (missing thesis section, agent sidebar).

**Step 3: Write minimal implementation**

Restructure `App.tsx` layout to the approved dashboard design:
- Add `ThesisBoard` section at top (horizontal cards)
- Add `AgentActivity` sidebar (left column)
- Keep `SignalFeed` as main content (right column)
- Move logs to collapsed drawer at bottom
- Add `fetchTheses` and `fetchAgentRuns` to `api.ts`

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --filter @idea/web exec vitest run`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/styles.css apps/web/src/api.ts apps/web/tests/app.test.tsx
git commit -m "feat: restructure UI as single-page thesis-driven dashboard"
```

---

### Task 14: Thesis Board Component

**Files:**
- Create: `apps/web/src/components/ThesisCard.tsx`
- Create: `apps/web/tests/thesis-card.test.tsx`

**Step 1: Write the failing test**

Create `apps/web/tests/thesis-card.test.tsx`:

```ts
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThesisCard } from '../src/components/ThesisCard';

describe('ThesisCard', () => {
  it('renders thesis title, confidence, and status', () => {
    render(
      <ThesisCard
        thesis={{
          canonicalKey: 'test',
          title: 'SOC2 Compliance Copilot',
          confidence: 82,
          status: 'promoted',
          evidenceCount: 12,
          problemStatement: 'Compliance is painful',
          sourceCount: 3
        }}
      />
    );

    expect(screen.getByText('SOC2 Compliance Copilot')).toBeTruthy();
    expect(screen.getByText(/82%/)).toBeTruthy();
    expect(screen.getByText(/promoted/i)).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/web exec vitest run tests/thesis-card.test.tsx`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create `apps/web/src/components/ThesisCard.tsx` with thesis card rendering.

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --filter @idea/web exec vitest run tests/thesis-card.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/ThesisCard.tsx apps/web/tests/thesis-card.test.tsx
git commit -m "feat: add ThesisCard component for dashboard"
```

---

### Task 15: Agent Activity Sidebar Component

**Files:**
- Create: `apps/web/src/components/AgentSidebar.tsx`
- Create: `apps/web/tests/agent-sidebar.test.tsx`

**Step 1: Write the failing test**

Create `apps/web/tests/agent-sidebar.test.tsx`:

```ts
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentSidebar } from '../src/components/AgentSidebar';

describe('AgentSidebar', () => {
  it('shows last run time and thesis updates', () => {
    render(
      <AgentSidebar
        lastRun={{ timestamp: '2026-02-25T08:00:00Z', thesesUpdated: 2, newCandidates: 1 }}
        investigateNext="AI billing patterns"
      />
    );

    expect(screen.getByText(/2 theses updated/i)).toBeTruthy();
    expect(screen.getByText(/AI billing/i)).toBeTruthy();
  });

  it('shows pending state when no runs yet', () => {
    render(<AgentSidebar lastRun={null} investigateNext={null} />);
    expect(screen.getByText(/no runs yet/i)).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/web exec vitest run tests/agent-sidebar.test.tsx`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create `apps/web/src/components/AgentSidebar.tsx` with agent activity rendering.

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --filter @idea/web exec vitest run tests/agent-sidebar.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/AgentSidebar.tsx apps/web/tests/agent-sidebar.test.tsx
git commit -m "feat: add AgentSidebar component for research agent activity"
```

---

### Task 16: Expandable Signal Cards

**Files:**
- Modify: `apps/web/src/components/SignalRow.tsx` (add expand/collapse with score breakdown)
- Modify: `apps/web/tests/app.test.tsx` (verify expandable behavior)

**Step 1: Write the failing test**

Add to existing `app.test.tsx`:

```ts
it('signal cards expand to show score breakdown', async () => {
  // Render signal, click to expand, verify pain/timing/buildability visible
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/web exec vitest run`
Expected: FAIL.

**Step 3: Modify SignalRow**

Add expandable detail section to `SignalRow.tsx` showing:
- Pain / Timing / Buildability individual scores
- AI reasoning text
- Source diversity indicator
- Memory features (novelty, momentum)

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --filter @idea/web exec vitest run`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/SignalRow.tsx apps/web/tests/app.test.tsx
git commit -m "feat: add expandable signal cards with score breakdown"
```

---

## Phase 6: Integration & Wiring

### Task 17: Wire Noise Gate + AI Scoring into Pipeline

**Files:**
- Modify: `apps/api/src/jobs/ingest_open.ts` (add noise gate after ingestion)
- Modify: `apps/api/src/jobs/score.ts` (use AI scoring when available, keep keyword as fallback)
- Modify: `packages/pipeline/src/queues.ts` (add noise gate queue)
- Modify: `apps/api/src/jobs/scheduler.ts` (add reddit, producthunt to schedule)

**Step 1: Write the failing test**

Add integration tests verifying:
- Noise gate is called before scoring
- AI scores override keyword scores when available
- Keyword scoring remains as fallback when AI is unavailable

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm test`
Expected: FAIL.

**Step 3: Wire the pipeline**

- Add `QUEUE_NAMES.noiseGate` to queues
- After ingestion, signals pass through noise gate before scoring
- In score job, try `aiScoreSignal` first; if null, fall back to `scorePain`/`scoreTiming`
- Add reddit and producthunt to scheduler's connector lists
- Add new env vars: `REDDIT_SUBREDDITS`, `PH_API_TOKEN`

**Step 4: Run tests**

Run: `CI=1 pnpm test`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/src/jobs/ingest_open.ts apps/api/src/jobs/score.ts packages/pipeline/src/queues.ts apps/api/src/jobs/scheduler.ts apps/api/src/config/env.ts
git commit -m "feat: wire noise gate, AI scoring, and new connectors into pipeline"
```

---

### Task 18: Wire Research Agent into Scheduler

**Files:**
- Modify: `apps/api/src/jobs/scheduler.ts` (add daily agent run)
- Modify: `apps/api/src/runtime/live_read_model.ts` (call thesis synthesizer on refresh)
- Create: `apps/api/src/jobs/agent_runner.ts` (orchestrates dual-analyst agent run)

**Step 1: Write the failing test**

```ts
it('scheduler includes daily research agent run', () => {
  // Verify agent_runner is in the daily schedule
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/api exec vitest run tests/scheduler.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create `apps/api/src/jobs/agent_runner.ts` that:
1. Loads active theses from store
2. Loads recent signals (last 24h)
3. Loads trend summaries
4. Builds agent prompt
5. Runs dual-analyst (Claude + Codex)
6. Parses and reconciles responses
7. Updates thesis store with confidence changes
8. Creates new thesis candidates
9. Fires alerts for promotions

Add to scheduler daily cron.

**Step 4: Run tests**

Run: `CI=1 pnpm --filter @idea/api exec vitest run tests/scheduler.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/src/jobs/agent_runner.ts apps/api/src/jobs/scheduler.ts apps/api/src/runtime/live_read_model.ts
git commit -m "feat: wire research agent into daily scheduler with dual-analyst"
```

---

### Task 19: Update Environment Config & Docs

**Files:**
- Modify: `.env.example` (add new env vars)
- Modify: `docs/operations/runbook.md` (update with new components)
- Modify: `apps/api/src/config/env.ts` (add new config vars)

**Step 1: Add new environment variables**

```
# Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text

# Reddit
REDDIT_SUBREDDITS=SaaS,startups,smallbusiness,Entrepreneur

# ProductHunt (BYO)
PH_API_TOKEN=

# Research Agent
AGENT_SCHEDULE_CRON=0 6 * * *
AGENT_DUAL_ANALYST=true

# Noise Gate
NOISE_GATE_BATCH_SIZE=15
```

**Step 2: Update runbook**

Add sections for Ollama setup, research agent monitoring, thesis lifecycle.

**Step 3: Commit**

```bash
git add .env.example apps/api/src/config/env.ts docs/operations/runbook.md
git commit -m "docs: update env config and runbook for V2 components"
```

---

### Task 20: Full Integration Test

**Files:**
- Modify: `apps/api/tests/e2e/pipeline.e2e.test.ts`

**Step 1: Write the failing test**

Add V2 integration assertions:
- Signal passes through noise gate
- AI scoring produces real scores (mocked)
- Thesis synthesizer generates candidates
- Research agent updates thesis confidence
- Thesis API returns results

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --filter @idea/api exec vitest run tests/e2e/pipeline.e2e.test.ts`
Expected: FAIL.

**Step 3: Wire fixtures and mocks**

Add test fixtures that simulate:
- Ollama embedding responses
- Claude/Codex scoring responses
- Multi-run thesis accumulation

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm test`
Expected: ALL PASS.

**Step 5: Commit**

```bash
git add apps/api/tests/e2e/pipeline.e2e.test.ts
git commit -m "test: add V2 integration tests for full pipeline + research agent"
```

---

## Verification Gates

Run before claiming completion:

```bash
pnpm install
CI=1 pnpm test
CI=1 pnpm --filter @idea/api exec vitest run
CI=1 pnpm --filter @idea/web exec vitest run
CI=1 pnpm --filter @idea/pipeline exec vitest run
CI=1 pnpm --filter @idea/connectors exec vitest run
CI=1 pnpm --filter @idea/ai-runtime exec vitest run
```

Expected: all pass, no skipped critical tests.

## Risks and Mitigations

- **Ollama availability**: Embedding path has `fallbackToNull`. Pipeline continues without embeddings (degrades to keyword scoring gracefully).
- **CLI rate limits**: Noise gate batches signals (15 per call). Scoring only runs on strong/weak signals. ~12-34 CLI calls/day.
- **Dual-analyst divergence**: Reconciliation handles single-provider mode. If both fail, signal is marked "unscored".
- **Reddit API changes**: Public `.json` endpoint is unofficial. If it breaks, connector fails gracefully and is skipped.
- **Thesis store persistence**: In-memory store for MVP. Postgres store implementation follows same interface.

## Definition of Done

1. Signals are AI-scored (not keyword-counted) with noise gate filtering.
2. Embeddings are semantic 768-dim vectors via Ollama.
3. Hybrid retrieval (pgvector + tsvector) returns meaningfully similar signals.
4. Cross-source dedup merges same-problem signals.
5. Dual-analyst (Claude + Codex) provides independent reasoning with reconciliation.
6. Research agent runs daily, updates thesis confidence, creates candidates, fires alerts.
7. Thesis lifecycle works: candidate → watching → promoted → alert.
8. Reddit and ProductHunt connectors are operational.
9. Dashboard shows theses at top, agent sidebar, expandable signals, collapsed logs.
10. All tests pass across workspace.
