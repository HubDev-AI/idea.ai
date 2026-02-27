# Smart Research Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the stateless research agent into a compounding intelligence system with persistent journal, semantic signal clustering, and iterative deepening.

**Architecture:** A new `agent_journal` table stores cross-run observations with vector embeddings. A signal clusterer groups recent signals by cosine similarity before analysis. The agent runner executes in phases: broad scan (clustered signals + journal context), then 1-2 deep dives (similarity search for historical signals + journal entries), then commits journal entries and thesis updates.

**Tech Stack:** PostgreSQL + pgvector, Ollama embeddings (768-dim), dual analyst (Claude + Codex), Fastify, Vitest

---

### Task 1: Create the agent_journal migration

**Files:**
- Create: `apps/api/db/migrations/0007_agent_journal.sql`

**Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS agent_journal (
  id            SERIAL PRIMARY KEY,
  run_id        TEXT NOT NULL,
  entry_type    TEXT NOT NULL CHECK (entry_type IN (
    'trend_shift', 'emerging_pattern', 'thesis_evolution', 'market_signal', 'run_summary'
  )),
  topic         TEXT NOT NULL,
  insight       TEXT NOT NULL,
  narrative     TEXT,
  confidence    NUMERIC(5,2) DEFAULT 50,
  thesis_keys   TEXT[] DEFAULT '{}',
  signal_ids    TEXT[] DEFAULT '{}',
  embedding     vector(768),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX agent_journal_type_idx ON agent_journal (entry_type);
CREATE INDEX agent_journal_created_idx ON agent_journal (created_at DESC);
CREATE INDEX agent_journal_embed_idx ON agent_journal USING hnsw (embedding vector_cosine_ops);
```

**Step 2: Verify SQL syntax**

Run: `cd apps/api && cat db/migrations/0007_agent_journal.sql`
Expected: Valid SQL, no syntax errors.

**Step 3: Commit**

```bash
git add apps/api/db/migrations/0007_agent_journal.sql
git commit -m "feat: add agent_journal table migration"
```

---

### Task 2: Create the JournalStore interface and PostgreSQL implementation

**Files:**
- Create: `apps/api/src/runtime/journal_store.ts`

**Step 1: Create the journal store**

The module exports a `JournalEntry` type, a `JournalStore` interface, and a `createPostgresJournalStore` factory. Follow the exact pattern of `postgres_memory_store.ts` — same `toNumber`, `toVectorLiteral`, Pool-based approach.

```typescript
import type { Pool } from 'pg';
import pg from 'pg';

const { Pool: PgPool } = pg;

export type JournalEntryType = 'trend_shift' | 'emerging_pattern' | 'thesis_evolution' | 'market_signal' | 'run_summary';

export type JournalEntry = {
  id?: number;
  run_id: string;
  entry_type: JournalEntryType;
  topic: string;
  insight: string;
  narrative: string | null;
  confidence: number;
  thesis_keys: string[];
  signal_ids: string[];
  embedding: number[] | null;
  created_at?: string;
};

export interface JournalStore {
  write(entries: JournalEntry[]): Promise<void>;
  recent(limit: number): Promise<JournalEntry[]>;
  byType(type: JournalEntryType, limit: number): Promise<JournalEntry[]>;
  byThesisKey(key: string, limit: number): Promise<JournalEntry[]>;
  findSimilar(embedding: number[], topK: number): Promise<JournalEntry[]>;
  count(): Promise<number>;
}

const toNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toVectorLiteral = (embedding: number[]): string =>
  `[${embedding.map((v) => (Number.isFinite(v) ? v : 0)).join(',')}]`;

const rowToEntry = (row: Record<string, unknown>): JournalEntry => ({
  id: toNumber(row.id),
  run_id: String(row.run_id ?? ''),
  entry_type: String(row.entry_type ?? 'run_summary') as JournalEntryType,
  topic: String(row.topic ?? ''),
  insight: String(row.insight ?? ''),
  narrative: row.narrative != null ? String(row.narrative) : null,
  confidence: toNumber(row.confidence),
  thesis_keys: Array.isArray(row.thesis_keys) ? row.thesis_keys.map(String) : [],
  signal_ids: Array.isArray(row.signal_ids) ? row.signal_ids.map(String) : [],
  embedding: null, // Don't return embedding blobs in queries
  created_at: row.created_at ? new Date(String(row.created_at)).toISOString() : undefined
});

export const createPostgresJournalStore = ({
  databaseUrl
}: {
  databaseUrl: string;
}): JournalStore => {
  const pool: Pool = new PgPool({
    connectionString: databaseUrl,
    max: 4,
    idleTimeoutMillis: 30_000
  });

  return {
    async write(entries: JournalEntry[]): Promise<void> {
      for (const entry of entries) {
        const embeddingParam = entry.embedding
          ? toVectorLiteral(entry.embedding)
          : null;
        await pool.query(
          `INSERT INTO agent_journal
            (run_id, entry_type, topic, insight, narrative, confidence, thesis_keys, signal_ids, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)`,
          [
            entry.run_id,
            entry.entry_type,
            entry.topic,
            entry.insight,
            entry.narrative,
            entry.confidence,
            entry.thesis_keys,
            entry.signal_ids,
            embeddingParam
          ]
        );
      }
    },

    async recent(limit: number): Promise<JournalEntry[]> {
      const result = await pool.query(
        `SELECT id, run_id, entry_type, topic, insight, narrative, confidence,
                thesis_keys, signal_ids, created_at
         FROM agent_journal
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );
      return result.rows.map(rowToEntry);
    },

    async byType(type: JournalEntryType, limit: number): Promise<JournalEntry[]> {
      const result = await pool.query(
        `SELECT id, run_id, entry_type, topic, insight, narrative, confidence,
                thesis_keys, signal_ids, created_at
         FROM agent_journal
         WHERE entry_type = $1
         ORDER BY created_at DESC
         LIMIT $1`,
        [type, limit]
      );
      return result.rows.map(rowToEntry);
    },

    async byThesisKey(key: string, limit: number): Promise<JournalEntry[]> {
      const result = await pool.query(
        `SELECT id, run_id, entry_type, topic, insight, narrative, confidence,
                thesis_keys, signal_ids, created_at
         FROM agent_journal
         WHERE $1 = ANY(thesis_keys)
         ORDER BY created_at DESC
         LIMIT $2`,
        [key, limit]
      );
      return result.rows.map(rowToEntry);
    },

    async findSimilar(embedding: number[], topK: number): Promise<JournalEntry[]> {
      const result = await pool.query(
        `SELECT id, run_id, entry_type, topic, insight, narrative, confidence,
                thesis_keys, signal_ids, created_at
         FROM agent_journal
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        [toVectorLiteral(embedding), topK]
      );
      return result.rows.map(rowToEntry);
    },

    async count(): Promise<number> {
      const result = await pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM agent_journal'
      );
      return result.rows[0]?.count ?? 0;
    }
  };
};
```

**Step 2: Verify no TypeScript errors**

Run: `cd apps/api && npx tsc --noEmit 2>&1 | grep journal_store`
Expected: No errors for this file.

**Step 3: Commit**

```bash
git add apps/api/src/runtime/journal_store.ts
git commit -m "feat: add JournalStore interface and PostgreSQL implementation"
```

---

### Task 3: Create the signal clusterer module

**Files:**
- Create: `apps/api/src/jobs/signal_clusterer.ts`
- Test: `apps/api/tests/signal-clusterer.test.ts`

**Step 1: Write the test**

```typescript
import { describe, expect, it } from 'vitest';
import { clusterSignals, type ClusterableSignal } from '../src/jobs/signal_clusterer';

const makeSignal = (id: string, embedding: number[], blended = 50): ClusterableSignal => ({
  signal_id: id,
  canonical_text: `signal ${id}`,
  source: 'test',
  pain: 50,
  timing: 50,
  blended,
  embedding
});

// Helper: create an embedding that is "close" to a base by adding small noise
const nearEmbedding = (base: number[], noise = 0.01): number[] =>
  base.map((v) => v + (Math.random() - 0.5) * noise);

describe('signal clusterer', () => {
  it('groups similar signals into clusters', () => {
    // Create two distinct clusters: one around [1,0,...] and one around [0,1,...]
    const base1 = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
    const base2 = Array.from({ length: 768 }, (_, i) => (i === 1 ? 1 : 0));

    const signals: ClusterableSignal[] = [
      makeSignal('a1', nearEmbedding(base1, 0.001), 90),
      makeSignal('a2', nearEmbedding(base1, 0.001), 80),
      makeSignal('a3', nearEmbedding(base1, 0.001), 70),
      makeSignal('b1', nearEmbedding(base2, 0.001), 85),
      makeSignal('b2', nearEmbedding(base2, 0.001), 75),
    ];

    const clusters = clusterSignals(signals, { maxRepresentatives: 2 });
    expect(clusters.length).toBe(2);
    // Each cluster should have at most 2 representatives
    for (const c of clusters) {
      expect(c.representatives.length).toBeLessThanOrEqual(2);
    }
    // Total representatives should be 4 (2 from each cluster)
    const totalReps = clusters.reduce((sum, c) => sum + c.representatives.length, 0);
    expect(totalReps).toBe(4);
  });

  it('returns single cluster when all signals are similar', () => {
    const base = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
    const signals = [
      makeSignal('a', nearEmbedding(base, 0.001), 90),
      makeSignal('b', nearEmbedding(base, 0.001), 80),
    ];
    const clusters = clusterSignals(signals);
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.totalCount).toBe(2);
  });

  it('returns empty array for empty input', () => {
    expect(clusterSignals([])).toEqual([]);
  });

  it('filters out signals below blended threshold', () => {
    const base = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
    const signals = [
      makeSignal('good', base, 60),
      makeSignal('bad', base, 10),
    ];
    const clusters = clusterSignals(signals, { minBlended: 30 });
    const allReps = clusters.flatMap((c) => c.representatives);
    expect(allReps.find((r) => r.signal_id === 'bad')).toBeUndefined();
  });

  it('caps total representatives', () => {
    // Create 50 very different signals
    const signals = Array.from({ length: 50 }, (_, i) => {
      const emb = Array.from({ length: 768 }, (_, j) => (j === i % 768 ? 1 : 0));
      return makeSignal(`s${i}`, emb, 60);
    });
    const clusters = clusterSignals(signals, { maxTotalRepresentatives: 10 });
    const totalReps = clusters.reduce((sum, c) => sum + c.representatives.length, 0);
    expect(totalReps).toBeLessThanOrEqual(10);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run tests/signal-clusterer.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the signal clusterer implementation**

```typescript
export type ClusterableSignal = {
  signal_id: string;
  canonical_text: string;
  source: string;
  pain: number;
  timing: number;
  blended: number;
  embedding: number[];
};

export type SignalCluster = {
  id: number;
  label: string;
  totalCount: number;
  representatives: ClusterableSignal[];
  avgPain: number;
  avgTiming: number;
  sources: string[];
};

export type ClusterOptions = {
  distanceThreshold?: number;    // cosine distance threshold (default 0.35)
  maxRepresentatives?: number;   // per cluster (default 3)
  maxTotalRepresentatives?: number; // cap across all clusters (default 120)
  minBlended?: number;           // filter out low-quality signals (default 30)
};

const cosineDistance = (a: number[], b: number[]): number => {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    magA += (a[i] ?? 0) ** 2;
    magB += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
};

export const clusterSignals = (
  signals: ClusterableSignal[],
  options: ClusterOptions = {}
): SignalCluster[] => {
  const {
    distanceThreshold = 0.35,
    maxRepresentatives = 3,
    maxTotalRepresentatives = 120,
    minBlended = 30
  } = options;

  // Filter and sort by blended score descending
  const filtered = signals
    .filter((s) => s.blended >= minBlended)
    .sort((a, b) => b.blended - a.blended);

  if (filtered.length === 0) return [];

  const assigned = new Set<string>();
  const clusters: SignalCluster[] = [];

  for (const seed of filtered) {
    if (assigned.has(seed.signal_id)) continue;

    const members: ClusterableSignal[] = [seed];
    assigned.add(seed.signal_id);

    for (const candidate of filtered) {
      if (assigned.has(candidate.signal_id)) continue;
      if (cosineDistance(seed.embedding, candidate.embedding) < distanceThreshold) {
        members.push(candidate);
        assigned.add(candidate.signal_id);
      }
    }

    // Pick top representatives by blended score (already sorted)
    const representatives = members.slice(0, maxRepresentatives);
    const sources = [...new Set(members.map((m) => m.source))];
    const avgPain = members.reduce((sum, m) => sum + m.pain, 0) / members.length;
    const avgTiming = members.reduce((sum, m) => sum + m.timing, 0) / members.length;

    // Derive label from most common topic-like content
    const label = representatives[0]?.canonical_text.split(' | ')[0]?.slice(0, 60) ?? 'unknown';

    clusters.push({
      id: clusters.length,
      label,
      totalCount: members.length,
      representatives,
      avgPain: Math.round(avgPain * 100) / 100,
      avgTiming: Math.round(avgTiming * 100) / 100,
      sources
    });
  }

  // Cap total representatives across all clusters
  let totalReps = 0;
  const capped: SignalCluster[] = [];
  for (const cluster of clusters) {
    const remaining = maxTotalRepresentatives - totalReps;
    if (remaining <= 0) break;
    const reps = cluster.representatives.slice(0, remaining);
    capped.push({ ...cluster, representatives: reps });
    totalReps += reps.length;
  }

  return capped;
};
```

**Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run tests/signal-clusterer.test.ts`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add apps/api/src/jobs/signal_clusterer.ts apps/api/tests/signal-clusterer.test.ts
git commit -m "feat: add signal clusterer with cosine-distance grouping"
```

---

### Task 4: Rewrite prompt templates for phased execution

**Files:**
- Modify: `apps/api/src/jobs/research_agent.ts`

**Step 1: Replace the entire file**

Keep existing types (`AgentOutput`, `ThesisUpdate`, `NewThesisProposal`) and add new types/prompts for broad scan and deep dive phases. Keep `parseAgentResponse` compatible.

```typescript
// === Existing types (keep as-is) ===

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

// === New types for phased execution ===

export type ClusterSummary = {
  id: number;
  label: string;
  totalCount: number;
  avgPain: number;
  avgTiming: number;
  sources: string[];
  signals: AgentSignalSummary[];
};

export type JournalSummary = {
  entry_type: string;
  topic: string;
  insight: string;
  narrative: string | null;
  created_at: string;
};

export type BroadScanContext = {
  activeTheses: AgentThesisSummary[];
  clusters: ClusterSummary[];
  recentJournal: JournalSummary[];
  trendSummary: AgentTrendSummary[];
};

export type BroadScanOutput = {
  thesis_updates: ThesisUpdate[];
  dig_deeper: { topic: string; reason: string; related_cluster_ids: number[] }[];
  observations: {
    entry_type: string;
    topic: string;
    insight: string;
    narrative: string;
  }[];
};

export type DeepDiveContext = {
  topic: string;
  reason: string;
  currentSignals: AgentSignalSummary[];
  historicalSignals: AgentSignalSummary[];
  journalHistory: JournalSummary[];
  relatedTheses: AgentThesisSummary[];
};

export type DeepDiveOutput = {
  thesis_updates: ThesisUpdate[];
  new_theses: NewThesisProposal[];
  journal_entries: {
    entry_type: string;
    topic: string;
    insight: string;
    narrative: string;
    confidence: number;
    thesis_keys: string[];
    signal_ids: string[];
  }[];
};

// === Legacy types for backwards compatibility ===

export type AgentContext = {
  activeTheses: AgentThesisSummary[];
  recentSignals: AgentSignalSummary[];
  trendSummary: AgentTrendSummary[];
};

export type AgentOutput = {
  theses_updated: ThesisUpdate[];
  new_theses: NewThesisProposal[];
  alerts: string[];
  investigate_next: string;
};

// === Prompt builders ===

export const buildBroadScanPrompt = (ctx: BroadScanContext): string => {
  const thesesBlock = ctx.activeTheses.length > 0
    ? ctx.activeTheses.map((t) =>
        `- "${t.title}" [${t.canonicalKey}] (confidence: ${t.confidence}%, ${t.evidenceCount} signals, status: ${t.status})`
      ).join('\n')
    : '(none yet)';

  const clustersBlock = ctx.clusters.length > 0
    ? ctx.clusters.map((c) => {
        const signals = c.signals.map((s) =>
          `    - [${s.signal_id}] [${s.source}] ${s.text.slice(0, 200)} (pain: ${s.pain}, timing: ${s.timing})`
        ).join('\n');
        return `  CLUSTER ${c.id}: "${c.label}" (${c.totalCount} signals, avg pain: ${c.avgPain}, sources: ${c.sources.join(', ')})\n${signals}`;
      }).join('\n\n')
    : '(no new signals)';

  const journalBlock = ctx.recentJournal.length > 0
    ? ctx.recentJournal.map((j) =>
        `- [${j.entry_type}] ${j.topic}: ${j.insight}${j.narrative ? `\n  Context: ${j.narrative.slice(0, 300)}` : ''}`
      ).join('\n')
    : '(first run — no previous observations)';

  const trendsBlock = ctx.trendSummary.length > 0
    ? ctx.trendSummary.map((t) =>
        `- "${t.topic}" ${t.window}: ${t.count} signals, avg pain ${t.avg_pain}, growth ${t.growth}`
      ).join('\n')
    : '(no trend data)';

  return `You are Sixth Sense, a SaaS opportunity intelligence system with persistent memory.
You analyze market signals continuously and maintain an evolving understanding of emerging opportunities.
Your observations from previous runs are shown below — use them to build on your prior reasoning.

YOUR RECENT OBSERVATIONS:
${journalBlock}

ACTIVE THESES YOU'RE TRACKING:
${thesesBlock}

NEW SIGNAL CLUSTERS (grouped by semantic similarity):
${clustersBlock}

TREND WINDOWS:
${trendsBlock}

YOUR TASK:
1. Analyze signal clusters. What patterns emerge across them? Do any clusters reinforce or contradict existing theses?
2. For each relevant thesis, provide a confidence_delta (-20 to +20) with reasoning.
3. Identify 1-3 topics that deserve deeper investigation. These should be areas where you see emerging patterns, contradictions, or high-potential signals that need more context.
4. Write 2-5 observations for your future self. Focus on patterns, shifts, and connections — not just summaries. Your future self will read these to understand what you were thinking.

Return ONLY valid JSON:
{
  "thesis_updates": [{"canonicalKey": "...", "confidence_delta": <n>, "reasoning": "..."}],
  "dig_deeper": [{"topic": "...", "reason": "...", "related_cluster_ids": [<n>]}],
  "observations": [{"entry_type": "trend_shift|emerging_pattern|thesis_evolution|market_signal", "topic": "...", "insight": "...", "narrative": "..."}]
}`;
};

export const buildDeepDivePrompt = (ctx: DeepDiveContext): string => {
  const currentBlock = ctx.currentSignals.map((s) =>
    `- [${s.signal_id}] [${s.source}] ${s.text.slice(0, 300)} (pain: ${s.pain}, timing: ${s.timing})`
  ).join('\n') || '(none)';

  const historicalBlock = ctx.historicalSignals.map((s) =>
    `- [${s.signal_id}] [${s.source}] ${s.text.slice(0, 300)} (pain: ${s.pain}, timing: ${s.timing})`
  ).join('\n') || '(no historical data)';

  const journalBlock = ctx.journalHistory.map((j) =>
    `- [${j.created_at}] [${j.entry_type}] ${j.insight}${j.narrative ? `\n  ${j.narrative.slice(0, 400)}` : ''}`
  ).join('\n') || '(no prior observations on this topic)';

  const thesesBlock = ctx.relatedTheses.map((t) =>
    `- "${t.title}" [${t.canonicalKey}] (confidence: ${t.confidence}%, ${t.evidenceCount} signals)`
  ).join('\n') || '(no related theses)';

  return `You are Sixth Sense, investigating: "${ctx.topic}"

REASON FOR INVESTIGATION:
${ctx.reason}

CURRENT SIGNALS ON THIS TOPIC:
${currentBlock}

HISTORICAL SIGNALS (from semantic search — may be weeks/months old):
${historicalBlock}

YOUR PAST OBSERVATIONS ON THIS TOPIC:
${journalBlock}

RELATED THESES:
${thesesBlock}

DEEP ANALYSIS:
1. What's the real pattern here? Look beyond individual signals at the underlying trend.
2. How has this area evolved over time? Compare current vs historical signals.
3. Should any existing thesis be updated? Should a new thesis be created?
4. Write detailed observations for your future self — what did you learn from this deep dive?

Return ONLY valid JSON:
{
  "thesis_updates": [{"canonicalKey": "...", "confidence_delta": <n>, "reasoning": "..."}],
  "new_theses": [{"title": "...", "problem_statement": "...", "target_buyer": "...", "proposed_solution": "...", "supporting_signal_ids": ["..."]}],
  "journal_entries": [{"entry_type": "...", "topic": "...", "insight": "...", "narrative": "...", "confidence": <n>, "thesis_keys": ["..."], "signal_ids": ["..."]}]
}`;
};

// === Parsers ===

export const parseBroadScanResponse = (raw: string): BroadScanOutput | null => {
  try {
    const text = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(text) as BroadScanOutput;
    if (!Array.isArray(parsed.thesis_updates)) return null;
    return {
      thesis_updates: parsed.thesis_updates ?? [],
      dig_deeper: parsed.dig_deeper ?? [],
      observations: parsed.observations ?? []
    };
  } catch {
    return null;
  }
};

export const parseDeepDiveResponse = (raw: string): DeepDiveOutput | null => {
  try {
    const text = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(text) as DeepDiveOutput;
    if (!Array.isArray(parsed.thesis_updates)) return null;
    return {
      thesis_updates: parsed.thesis_updates ?? [],
      new_theses: parsed.new_theses ?? [],
      journal_entries: parsed.journal_entries ?? []
    };
  } catch {
    return null;
  }
};

// === Legacy prompt (kept for backwards compatibility with old tests) ===

export const buildAgentPrompt = (ctx: AgentContext): string => {
  const thesesBlock = ctx.activeTheses.length > 0
    ? ctx.activeTheses.map((t) =>
        `- "${t.title}" (confidence: ${t.confidence}%, ${t.evidenceCount} signals, status: ${t.status})`
      ).join('\n')
    : '(none yet)';

  const signalsBlock = ctx.recentSignals.length > 0
    ? ctx.recentSignals.map((s) =>
        `- [${s.signal_id}] [${s.source}] ${s.text.slice(0, 200)} (pain: ${s.pain}, timing: ${s.timing})`
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
    const text = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(text) as AgentOutput;
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

**Step 2: Verify no TypeScript errors**

Run: `cd apps/api && npx tsc --noEmit 2>&1 | grep research_agent`
Expected: No errors.

**Step 3: Run existing tests to verify backwards compatibility**

Run: `cd apps/api && npx vitest run tests/agent-runner.test.ts`
Expected: All 3 existing tests PASS (they use the legacy `buildAgentPrompt` + `parseAgentResponse`).

**Step 4: Commit**

```bash
git add apps/api/src/jobs/research_agent.ts
git commit -m "feat: add broad scan and deep dive prompt templates"
```

---

### Task 5: Rewrite agent_runner.ts with phased execution

**Files:**
- Modify: `apps/api/src/jobs/agent_runner.ts`

**Step 1: Rewrite the agent runner**

The new runner executes in 3 phases: broad scan, deep dives, commit. It requires a `journalStore` and `embedText` function in its deps.

```typescript
import { dualAnalystRun } from '@idea/ai-runtime/src/dual_analyst';
import type { RunPromptInput, RunPromptResult } from '@idea/ai-runtime/src/types';
import type { JournalEntry, JournalStore } from '../runtime/journal_store';
import type { PostgresMemoryStore } from '../runtime/postgres_memory_store';
import type { ThesisStore } from '../runtime/thesis_store';
import { type ClusterableSignal, clusterSignals } from './signal_clusterer';
import {
  type AgentThesisSummary,
  type BroadScanOutput,
  type DeepDiveOutput,
  buildBroadScanPrompt,
  buildDeepDivePrompt,
  parseBroadScanResponse,
  parseDeepDiveResponse,
} from './research_agent';

export type AgentRunResult = {
  thesesUpdated: number;
  newCandidates: number;
  alerts: string[];
  investigateNext: string;
  journalEntriesWritten: number;
  clustersAnalyzed: number;
  deepDivesPerformed: number;
};

export type AgentRunnerDeps = {
  thesisStore: ThesisStore;
  memoryStore?: PostgresMemoryStore | null;
  journalStore?: JournalStore | null;
  embedText?: (text: string) => Promise<number[] | null>;
  runClaude: (input: RunPromptInput) => Promise<RunPromptResult>;
  runCodex: (input: RunPromptInput) => Promise<RunPromptResult>;
};

const MAX_DEEP_DIVES = 2;
const AGENT_TIMEOUT_MS = 60_000;

const clampDelta = (delta: number): number =>
  Math.max(-20, Math.min(20, delta));

export const runResearchAgent = async (deps: AgentRunnerDeps): Promise<AgentRunResult> => {
  const runId = `agent-${Date.now()}`;
  let thesesUpdated = 0;
  let newCandidates = 0;
  const allAlerts: string[] = [];
  const allJournalEntries: JournalEntry[] = [];
  let investigateNext = '';

  // === Load context ===
  const allTheses = await deps.thesisStore.list();
  const activeTheses: AgentThesisSummary[] = allTheses
    .filter((t) => t.status !== 'stale' && t.status !== 'rejected')
    .slice(0, 15)
    .map((t) => ({
      canonicalKey: t.canonicalKey,
      title: t.title,
      confidence: t.confidence,
      status: t.status,
      evidenceCount: t.evidenceCount
    }));

  // Load recent signals with embeddings for clustering
  const recentSignals = deps.memoryStore
    ? await deps.memoryStore.listAllSignals(500)
    : [];

  // Load embeddings for clustering
  let clusterableSignals: ClusterableSignal[] = [];
  if (deps.memoryStore && recentSignals.length > 0) {
    // Query embeddings for the recent signals
    const signalIds = recentSignals.map((s) => s.signal_id);
    const embeddingRows = await loadEmbeddings(deps.memoryStore, signalIds);

    clusterableSignals = recentSignals
      .filter((s) => embeddingRows.has(s.signal_id))
      .map((s) => ({
        signal_id: s.signal_id,
        canonical_text: s.canonical_text,
        source: s.source,
        pain: s.pain,
        timing: s.timing,
        blended: s.blended,
        embedding: embeddingRows.get(s.signal_id)!
      }));
  }

  const clusters = clusterSignals(clusterableSignals);

  // Load trend windows
  const trendSummary = deps.memoryStore
    ? (await deps.memoryStore.retriever.getTrendWindows({
        topic: 'general',
        source: 'all',
        canonicalText: ''
      })).map((tw) => ({
        topic: tw.topic,
        window: tw.window,
        count: tw.count_signals,
        avg_pain: tw.avg_pain,
        growth: tw.count_signals > 0 ? 'active' : 'none'
      }))
    : [];

  // Load recent journal entries
  const recentJournal = deps.journalStore
    ? await deps.journalStore.recent(5)
    : [];

  // === Phase 1: Broad Scan ===
  const broadCtx = {
    activeTheses,
    clusters: clusters.map((c) => ({
      id: c.id,
      label: c.label,
      totalCount: c.totalCount,
      avgPain: c.avgPain,
      avgTiming: c.avgTiming,
      sources: c.sources,
      signals: c.representatives.map((s) => ({
        signal_id: s.signal_id,
        text: s.canonical_text,
        source: s.source,
        pain: s.pain,
        timing: s.timing
      }))
    })),
    recentJournal: recentJournal.map((j) => ({
      entry_type: j.entry_type,
      topic: j.topic,
      insight: j.insight,
      narrative: j.narrative,
      created_at: j.created_at ?? ''
    })),
    trendSummary
  };

  const broadPrompt = buildBroadScanPrompt(broadCtx);
  const broadResult = await dualAnalystRun<BroadScanOutput>(
    { prompt: broadPrompt, timeoutMs: AGENT_TIMEOUT_MS },
    {
      runClaude: deps.runClaude,
      runCodex: deps.runCodex,
      parseResponse: (text) => {
        const parsed = parseBroadScanResponse(text);
        if (!parsed) throw new Error('Failed to parse broad scan response');
        return parsed;
      }
    }
  );

  const broadOutput = broadResult.claude ?? broadResult.codex;

  // Apply broad scan thesis updates
  if (broadOutput) {
    for (const update of broadOutput.thesis_updates) {
      const existing = await deps.thesisStore.getByKey(update.canonicalKey);
      if (existing) {
        const delta = clampDelta(update.confidence_delta);
        const newConfidence = Math.max(0, Math.min(100, existing.confidence + delta));
        const newStatus = newConfidence >= 80 ? 'promoted' : newConfidence >= 55 ? 'watching' : existing.status;
        await deps.thesisStore.upsert({ ...existing, confidence: newConfidence, status: newStatus });
        thesesUpdated++;
        if (newConfidence >= 80 && existing.confidence < 80) {
          allAlerts.push(update.canonicalKey);
        }
      }
    }

    // Collect broad scan observations as journal entries
    for (const obs of broadOutput.observations) {
      allJournalEntries.push({
        run_id: runId,
        entry_type: obs.entry_type as JournalEntry['entry_type'],
        topic: obs.topic,
        insight: obs.insight,
        narrative: obs.narrative,
        confidence: 50,
        thesis_keys: [],
        signal_ids: [],
        embedding: null
      });
    }
  }

  // === Phase 2: Deep Dives ===
  const digTopics = broadOutput?.dig_deeper?.slice(0, MAX_DEEP_DIVES) ?? [];
  let deepDivesPerformed = 0;

  for (const dig of digTopics) {
    investigateNext = dig.topic;

    // Gather current cluster signals for this topic
    const relatedClusters = clusters.filter((c) =>
      dig.related_cluster_ids?.includes(c.id)
    );
    const currentSignals = relatedClusters
      .flatMap((c) => c.representatives)
      .map((s) => ({
        signal_id: s.signal_id,
        text: s.canonical_text,
        source: s.source,
        pain: s.pain,
        timing: s.timing
      }));

    // Similarity search for historical signals
    let historicalSignals: { signal_id: string; text: string; source: string; pain: number; timing: number }[] = [];
    if (deps.memoryStore && deps.embedText) {
      const topicEmbedding = await deps.embedText(dig.topic);
      if (topicEmbedding) {
        const similar = await deps.memoryStore.retriever.findSimilar({
          topic: dig.topic,
          source: 'all',
          canonicalText: dig.topic,
          topK: 20
        });
        historicalSignals = similar.map((s) => ({
          signal_id: s.signal_id,
          text: s.signal_id, // findSimilar doesn't return text, use ID
          source: s.source,
          pain: s.pain,
          timing: s.timing
        }));
      }
    }

    // Search journal for past insights on this topic
    let journalHistory = recentJournal; // fallback to recent
    if (deps.journalStore && deps.embedText) {
      const topicEmbedding = await deps.embedText(dig.topic);
      if (topicEmbedding) {
        journalHistory = await deps.journalStore.findSimilar(topicEmbedding, 10);
      }
    }

    // Related theses
    const relatedTheses = activeTheses.filter((t) =>
      t.title.toLowerCase().includes(dig.topic.toLowerCase()) ||
      dig.topic.toLowerCase().includes(t.title.toLowerCase().split(' ')[0] ?? '')
    );

    const diveCtx = {
      topic: dig.topic,
      reason: dig.reason,
      currentSignals,
      historicalSignals,
      journalHistory: journalHistory.map((j) => ({
        entry_type: j.entry_type,
        topic: j.topic,
        insight: j.insight,
        narrative: j.narrative,
        created_at: j.created_at ?? ''
      })),
      relatedTheses
    };

    const divePrompt = buildDeepDivePrompt(diveCtx);
    const diveResult = await dualAnalystRun<DeepDiveOutput>(
      { prompt: divePrompt, timeoutMs: AGENT_TIMEOUT_MS },
      {
        runClaude: deps.runClaude,
        runCodex: deps.runCodex,
        parseResponse: (text) => {
          const parsed = parseDeepDiveResponse(text);
          if (!parsed) throw new Error('Failed to parse deep dive response');
          return parsed;
        }
      }
    );

    const diveOutput = diveResult.claude ?? diveResult.codex;
    if (diveOutput) {
      // Apply deep dive thesis updates
      for (const update of diveOutput.thesis_updates) {
        const existing = await deps.thesisStore.getByKey(update.canonicalKey);
        if (existing) {
          const delta = clampDelta(update.confidence_delta);
          const newConfidence = Math.max(0, Math.min(100, existing.confidence + delta));
          const newStatus = newConfidence >= 80 ? 'promoted' : newConfidence >= 55 ? 'watching' : existing.status;
          await deps.thesisStore.upsert({ ...existing, confidence: newConfidence, status: newStatus });
          thesesUpdated++;
          if (newConfidence >= 80 && existing.confidence < 80) {
            allAlerts.push(update.canonicalKey);
          }
        }
      }

      // Create new thesis candidates from deep dive
      for (const proposal of diveOutput.new_theses) {
        const key = `agent:${proposal.title.toLowerCase().replace(/\s+/g, '_').slice(0, 40)}`;
        await deps.thesisStore.upsert({
          canonicalKey: key,
          title: proposal.title,
          topic: 'agent_generated',
          status: 'candidate',
          confidence: 45,
          scoreTotal: 45,
          problemStatement: proposal.problem_statement,
          targetBuyer: proposal.target_buyer,
          proposedSolution: proposal.proposed_solution,
          evidenceCount: proposal.supporting_signal_ids.length,
          avgPain: 50,
          avgTiming: 50,
          avgBuildability: 50,
          latestObservedAt: new Date().toISOString(),
          evidence: []
        });
        newCandidates++;
      }

      // Collect deep dive journal entries
      for (const entry of diveOutput.journal_entries) {
        allJournalEntries.push({
          run_id: runId,
          entry_type: entry.entry_type as JournalEntry['entry_type'],
          topic: entry.topic,
          insight: entry.insight,
          narrative: entry.narrative,
          confidence: entry.confidence,
          thesis_keys: entry.thesis_keys,
          signal_ids: entry.signal_ids,
          embedding: null
        });
      }
    }

    deepDivesPerformed++;
  }

  // === Phase 3: Commit journal entries ===

  // Add run summary
  allJournalEntries.push({
    run_id: runId,
    entry_type: 'run_summary',
    topic: 'general',
    insight: `Analyzed ${clusters.length} clusters (${clusterableSignals.length} signals), updated ${thesesUpdated} theses, created ${newCandidates} new candidates, performed ${deepDivesPerformed} deep dives.`,
    narrative: investigateNext ? `Next investigation: ${investigateNext}` : null,
    confidence: 50,
    thesis_keys: [],
    signal_ids: [],
    embedding: null
  });

  // Embed and write journal entries
  if (deps.journalStore) {
    if (deps.embedText) {
      for (const entry of allJournalEntries) {
        const text = `${entry.topic}: ${entry.insight}`;
        entry.embedding = await deps.embedText(text).catch(() => null);
      }
    }
    await deps.journalStore.write(allJournalEntries);
  }

  return {
    thesesUpdated,
    newCandidates,
    alerts: allAlerts,
    investigateNext,
    journalEntriesWritten: allJournalEntries.length,
    clustersAnalyzed: clusters.length,
    deepDivesPerformed
  };
};

// Helper: load embeddings for a batch of signal IDs
// This queries signal_embeddings directly. We add this as a method
// on the memory store in a later step, but for now use a raw query workaround.
async function loadEmbeddings(
  memoryStore: PostgresMemoryStore,
  signalIds: string[]
): Promise<Map<string, number[]>> {
  // Use the retriever's findSimilar with a trivial query to access the pool
  // For now, return empty — we'll wire this properly in Task 7
  const map = new Map<string, number[]>();
  // The proper implementation will query signal_embeddings directly
  return map;
}
```

**IMPORTANT:** The `loadEmbeddings` function is a placeholder. Task 7 will add a `getEmbeddings` method to `PostgresMemoryStore` and wire it here.

**Step 2: Verify no TypeScript errors**

Run: `cd apps/api && npx tsc --noEmit 2>&1 | grep agent_runner`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/api/src/jobs/agent_runner.ts
git commit -m "feat: rewrite agent runner with phased execution — broad scan + deep dives"
```

---

### Task 6: Update agent runner tests

**Files:**
- Modify: `apps/api/tests/agent-runner.test.ts`

**Step 1: Update existing tests and add new ones**

The existing 3 tests still work because the `runResearchAgent` function signature is backwards-compatible (journalStore and embedText are optional). Add new tests for the phased execution.

```typescript
import { describe, expect, it, vi } from 'vitest';
import { runResearchAgent } from '../src/jobs/agent_runner';
import { InMemoryThesisStore } from '../src/runtime/thesis_store';

// Helper to create mock AI response
const mockAiResponse = (text: string) =>
  vi.fn().mockResolvedValue({ text, provider: 'claude', meta: {} });

const failingAi = () =>
  vi.fn().mockRejectedValue(new Error('unavailable'));

describe('agent runner', () => {
  // === Existing tests (keep as-is — they test legacy compatibility) ===

  it('updates thesis confidence based on agent output', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'compliance:soc2', title: 'SOC2 copilot', topic: 'compliance',
      status: 'watching', confidence: 72, scoreTotal: 72,
      problemStatement: 'p', targetBuyer: 'b', proposedSolution: 's',
      evidenceCount: 5, avgPain: 70, avgTiming: 60, avgBuildability: 65,
      latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    });

    // The new agent runner expects BroadScanOutput format
    const broadOutput = {
      thesis_updates: [{ canonicalKey: 'compliance:soc2', confidence_delta: 10, reasoning: 'new evidence' }],
      dig_deeper: [],
      observations: []
    };

    const result = await runResearchAgent({
      thesisStore: store,
      runClaude: mockAiResponse(JSON.stringify(broadOutput)),
      runCodex: failingAi()
    });

    expect(result.thesesUpdated).toBe(1);
    const updated = await store.getByKey('compliance:soc2');
    expect(updated?.confidence).toBe(82);
    expect(updated?.status).toBe('promoted');
  });

  it('returns empty result when both providers fail', async () => {
    const store = new InMemoryThesisStore();
    const result = await runResearchAgent({
      thesisStore: store,
      runClaude: failingAi(),
      runCodex: failingAi()
    });

    expect(result.thesesUpdated).toBe(0);
    expect(result.newCandidates).toBe(0);
    expect(result.deepDivesPerformed).toBe(0);
  });

  // === New tests for phased execution ===

  it('performs deep dive when broad scan suggests dig_deeper', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'billing:copilot', title: 'Billing Copilot', topic: 'billing',
      status: 'watching', confidence: 60, scoreTotal: 60,
      problemStatement: 'p', targetBuyer: 'b', proposedSolution: 's',
      evidenceCount: 3, avgPain: 65, avgTiming: 55, avgBuildability: 60,
      latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    });

    const broadOutput = {
      thesis_updates: [],
      dig_deeper: [{ topic: 'billing automation', reason: 'cluster growing fast', related_cluster_ids: [0] }],
      observations: [{ entry_type: 'emerging_pattern', topic: 'billing', insight: 'growing demand', narrative: 'details...' }]
    };

    const deepOutput = {
      thesis_updates: [{ canonicalKey: 'billing:copilot', confidence_delta: 15, reasoning: 'deep evidence' }],
      new_theses: [{
        title: 'Invoice AI',
        problem_statement: 'Manual invoice processing',
        target_buyer: 'Accounting teams',
        proposed_solution: 'AI-powered invoice parser',
        supporting_signal_ids: ['sig-1']
      }],
      journal_entries: [{ entry_type: 'thesis_evolution', topic: 'billing', insight: 'strong trend', narrative: 'analysis...', confidence: 75, thesis_keys: ['billing:copilot'], signal_ids: ['sig-1'] }]
    };

    // First call = broad scan, second call = deep dive
    let callCount = 0;
    const mockClaude = vi.fn().mockImplementation(() => {
      callCount++;
      const output = callCount === 1 ? broadOutput : deepOutput;
      return Promise.resolve({ text: JSON.stringify(output), provider: 'claude', meta: {} });
    });

    const journalEntries: Array<{ insight: string }> = [];
    const mockJournal = {
      write: vi.fn().mockImplementation((entries: Array<{ insight: string }>) => { journalEntries.push(...entries); return Promise.resolve(); }),
      recent: vi.fn().mockResolvedValue([]),
      byType: vi.fn().mockResolvedValue([]),
      byThesisKey: vi.fn().mockResolvedValue([]),
      findSimilar: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0)
    };

    const result = await runResearchAgent({
      thesisStore: store,
      journalStore: mockJournal,
      runClaude: mockClaude,
      runCodex: failingAi()
    });

    expect(result.deepDivesPerformed).toBe(1);
    expect(result.newCandidates).toBe(1);
    expect(result.thesesUpdated).toBe(1);
    expect(result.journalEntriesWritten).toBeGreaterThan(0);
    expect(mockJournal.write).toHaveBeenCalled();

    // Verify thesis was updated by deep dive
    const updated = await store.getByKey('billing:copilot');
    expect(updated?.confidence).toBe(75); // 60 + 15

    // Verify new thesis was created
    const all = await store.list();
    expect(all.find((t) => t.title === 'Invoice AI')).toBeDefined();
  });

  it('writes run summary journal entry even with no deep dives', async () => {
    const store = new InMemoryThesisStore();

    const broadOutput = {
      thesis_updates: [],
      dig_deeper: [],
      observations: [{ entry_type: 'market_signal', topic: 'general', insight: 'quiet period', narrative: 'no major shifts' }]
    };

    const journalEntries: Array<{ entry_type: string }> = [];
    const mockJournal = {
      write: vi.fn().mockImplementation((entries: Array<{ entry_type: string }>) => { journalEntries.push(...entries); return Promise.resolve(); }),
      recent: vi.fn().mockResolvedValue([]),
      byType: vi.fn().mockResolvedValue([]),
      byThesisKey: vi.fn().mockResolvedValue([]),
      findSimilar: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0)
    };

    const result = await runResearchAgent({
      thesisStore: store,
      journalStore: mockJournal,
      runClaude: mockAiResponse(JSON.stringify(broadOutput)),
      runCodex: failingAi()
    });

    expect(result.deepDivesPerformed).toBe(0);
    expect(result.journalEntriesWritten).toBe(2); // 1 observation + 1 run_summary
    const summary = journalEntries.find((e) => e.entry_type === 'run_summary');
    expect(summary).toBeDefined();
  });

  it('clamps confidence delta to ±20', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'test:thesis', title: 'Test', topic: 'test',
      status: 'watching', confidence: 50, scoreTotal: 50,
      problemStatement: 'p', targetBuyer: 'b', proposedSolution: 's',
      evidenceCount: 3, avgPain: 50, avgTiming: 50, avgBuildability: 50,
      latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    });

    const broadOutput = {
      thesis_updates: [{ canonicalKey: 'test:thesis', confidence_delta: 50, reasoning: 'huge jump' }],
      dig_deeper: [],
      observations: []
    };

    await runResearchAgent({
      thesisStore: store,
      runClaude: mockAiResponse(JSON.stringify(broadOutput)),
      runCodex: failingAi()
    });

    const updated = await store.getByKey('test:thesis');
    expect(updated?.confidence).toBe(70); // 50 + 20 (clamped from 50)
  });
});
```

**Step 2: Run tests**

Run: `cd apps/api && npx vitest run tests/agent-runner.test.ts`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add apps/api/tests/agent-runner.test.ts
git commit -m "test: update agent runner tests for phased execution"
```

---

### Task 7: Add getEmbeddings method to PostgresMemoryStore and wire loadEmbeddings

**Files:**
- Modify: `apps/api/src/runtime/postgres_memory_store.ts`
- Modify: `apps/api/src/jobs/agent_runner.ts`

**Step 1: Add `getEmbeddings` to the store type and implementation**

In `postgres_memory_store.ts`, add to the `PostgresMemoryStore` type:

```typescript
getEmbeddings: (signalIds: string[]) => Promise<Map<string, number[]>>;
```

Add the implementation inside `createPostgresMemoryStore`, before the return statement:

```typescript
const getEmbeddings = async (signalIds: string[]): Promise<Map<string, number[]>> => {
  if (signalIds.length === 0) return new Map();
  const placeholders = signalIds.map((_, i) => `$${i + 1}`).join(',');
  const result = await pool.query<{ signal_id: string; embedding: string }>(
    `SELECT signal_id, embedding::text FROM signal_embeddings WHERE signal_id IN (${placeholders})`,
    signalIds
  );
  const map = new Map<string, number[]>();
  for (const row of result.rows) {
    // pgvector returns embedding as "[0.1,0.2,...]" string
    const nums = row.embedding
      .replace(/^\[/, '').replace(/\]$/, '')
      .split(',')
      .map(Number)
      .filter(Number.isFinite);
    if (nums.length > 0) {
      map.set(row.signal_id, nums);
    }
  }
  return map;
};
```

Add `getEmbeddings` to the return object.

**Step 2: Wire loadEmbeddings in agent_runner.ts**

Replace the placeholder `loadEmbeddings` function:

```typescript
async function loadEmbeddings(
  memoryStore: PostgresMemoryStore,
  signalIds: string[]
): Promise<Map<string, number[]>> {
  return memoryStore.getEmbeddings(signalIds);
}
```

**Step 3: Verify no TypeScript errors**

Run: `cd apps/api && npx tsc --noEmit 2>&1 | head -5`
Expected: No errors (or only pre-existing ones).

**Step 4: Commit**

```bash
git add apps/api/src/runtime/postgres_memory_store.ts apps/api/src/jobs/agent_runner.ts
git commit -m "feat: add getEmbeddings to memory store, wire into agent runner"
```

---

### Task 8: Wire journalStore into main.ts

**Files:**
- Modify: `apps/api/src/main.ts`

**Step 1: Add imports and create journal store**

Add import at the top:

```typescript
import { createPostgresJournalStore } from './runtime/journal_store';
import { embedText } from '@idea/ai-runtime/src/ollama';
```

After the `memoryStore` declaration, add:

```typescript
const journalStore = databaseUrl
  ? createPostgresJournalStore({ databaseUrl })
  : null;
```

**Step 2: Pass journalStore and embedText to executeAgentRun**

Update the `runResearchAgent` call inside `executeAgentRun`:

```typescript
agentRunInFlight = runResearchAgent({
  thesisStore,
  memoryStore,
  journalStore,
  embedText: (text: string) => embedText(text, { fallbackToNull: true }),
  runClaude: runClaudePrompt,
  runCodex: runCodexPrompt
}).finally(() => {
  agentRunInFlight = null;
});
```

**Step 3: Update agentStatus to include new fields**

Update the status assignment after the result:

```typescript
agentStatus = {
  lastRun: {
    timestamp: new Date().toISOString(),
    thesesUpdated: result.thesesUpdated,
    newCandidates: result.newCandidates
  },
  investigateNext: result.investigateNext || null
};
```

(This stays the same — the AgentStatusRecord type doesn't need to change for now. The extra fields like `journalEntriesWritten` are returned by the POST endpoint.)

**Step 4: Verify no TypeScript errors**

Run: `cd apps/api && npx tsc --noEmit 2>&1 | grep main.ts`
Expected: No errors.

**Step 5: Commit**

```bash
git add apps/api/src/main.ts
git commit -m "feat: wire journalStore and embedText into agent runner"
```

---

### Task 9: Update AgentRunResult in contracts and web API

**Files:**
- Modify: `apps/web/src/api.ts`

**Step 1: Update the web client AgentRunResult type**

The web client's `AgentRunResult` should match the new return type. Update in `apps/web/src/api.ts`:

```typescript
export type AgentRunResult = {
  thesesUpdated: number;
  newCandidates: number;
  alerts: string[];
  investigateNext: string;
  journalEntriesWritten: number;
  clustersAnalyzed: number;
  deepDivesPerformed: number;
};
```

**Step 2: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat: update AgentRunResult type with new fields"
```

---

### Task 10: Run all tests and fix any failures

**Step 1: Run all tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && pnpm exec vitest run --reporter=verbose`
Expected: All 177+ tests pass (existing + new signal clusterer + updated agent runner tests).

**Step 2: Fix any TypeScript errors**

Run: `cd apps/api && npx tsc --noEmit`
Expected: No errors (or only pre-existing ones in unrelated files).

**Step 3: Fix any test failures**

If any test fails, fix it. Common issues:
- Missing import for new types
- Mock objects missing new optional fields
- JSON parse differences with markdown fences

**Step 4: Final commit**

```bash
git add -A
git commit -m "fix: resolve any test/type issues from smart agent refactor"
```

---

### Task 11: Apply migration and integration test

**Step 1: Start infrastructure**

```bash
pnpm infra:up
```

**Step 2: Apply the migration**

```bash
cd apps/api && psql "$DATABASE_URL" -f db/migrations/0007_agent_journal.sql
```

Expected: `CREATE TABLE`, `CREATE INDEX` x3.

**Step 3: Start the API**

```bash
pnpm exec tsx apps/api/src/main.ts
```

**Step 4: Trigger a manual run**

```bash
curl -s -X POST http://localhost:3000/v1/agent/run | jq .
```

Expected: JSON with `thesesUpdated`, `newCandidates`, `journalEntriesWritten`, `clustersAnalyzed`, `deepDivesPerformed`.

**Step 5: Verify journal entries were written**

```bash
psql "$DATABASE_URL" -c "SELECT id, entry_type, topic, insight FROM agent_journal ORDER BY created_at DESC LIMIT 5;"
```

Expected: At least 1 `run_summary` entry plus any observations.

**Step 6: Verify agent status**

```bash
curl -s http://localhost:3000/v1/agent/status | jq .
```

Expected: `lastRun` has timestamp and counts.

**Step 7: Final commit**

```bash
git add -A
git commit -m "feat: smart research agent — journal, clustering, iterative deepening"
```
