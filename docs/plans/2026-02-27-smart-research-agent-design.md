# Smart Research Agent Design

**Date:** 2026-02-27
**Status:** Approved

## Problem

The current research agent is stateless and shallow. Each run loads 50 recent signals and 10 theses, sends a single prompt, and applies results mechanically. It has no memory across runs, doesn't use the existing embedding infrastructure for signal selection, and can't see patterns that emerge over weeks or months. It's a "dumb crawl and analyze" loop.

## Goal

Transform the research agent into a compounding intelligence system that:
1. Clusters signals by semantic similarity instead of a flat "most recent" list
2. Uses iterative deepening — broad scan first, then focused investigation
3. Maintains a persistent journal of observations, patterns, and reasoning
4. Reads its own history to build richer context over time

## Design

### 1. Agent Journal Table

New PostgreSQL table for persistent cross-run memory:

```sql
CREATE TABLE agent_journal (
  id            SERIAL PRIMARY KEY,
  run_id        TEXT NOT NULL,
  entry_type    TEXT NOT NULL,  -- 'trend_shift' | 'emerging_pattern' | 'thesis_evolution' | 'market_signal' | 'run_summary'
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

**Entry types:**
- `trend_shift` — "Compliance signals are growing 3x week-over-week"
- `emerging_pattern` — "Multiple signals point to developer tools fatigue"
- `thesis_evolution` — "SOC2 copilot thesis strengthened by 3 new enterprise signals"
- `market_signal` — "Major competitor launched in this space, affects thesis X"
- `run_summary` — High-level summary of what the agent saw and did this run

Each entry has structured fields for programmatic querying AND a free-text `narrative` field for the agent's qualitative reasoning.

### 2. Journal Store Interface

```typescript
interface JournalStore {
  write(entries: JournalEntry[]): Promise<void>;
  recent(limit: number): Promise<JournalEntry[]>;
  byType(type: EntryType, limit: number): Promise<JournalEntry[]>;
  byThesisKey(key: string, limit: number): Promise<JournalEntry[]>;
  findSimilar(embedding: number[], topK: number): Promise<JournalEntry[]>;
}
```

Implementation: `PostgresJournalStore` in `apps/api/src/runtime/journal_store.ts`.

### 3. Signal Clustering

Replace the current "top 50 most recent" selection with semantic clustering:

**Step 1 — Load candidates:**
- Fetch all signals since last run (or last 24h on first run)
- Filter by `blended > 30` to drop low-quality noise
- Load their embeddings from `signal_embeddings`

**Step 2 — Greedy cosine clustering:**
```
clusters = []
unassigned = all signals sorted by blended DESC
while unassigned is not empty:
  seed = unassigned[0]  // highest-ranked unassigned
  cluster = [seed]
  for each remaining signal in unassigned:
    if cosine_distance(seed.embedding, signal.embedding) < 0.35:
      cluster.push(signal)
  clusters.push(cluster)
  remove cluster members from unassigned
```

**Step 3 — Select representatives:**
- From each cluster, pick top 3 signals by blended score
- Cap total at ~120 signals
- Label each cluster by its dominant topic

**Output format for prompts:**
```
CLUSTER 1: "compliance automation" (12 signals)
  Representatives:
  - [sig_001] SOC2 prep copilot (pain: 85, timing: 72) — hacker_news
  - [sig_002] Audit workflow tool (pain: 78, timing: 65) — github_issues
  - [sig_003] Compliance checklist (pain: 71, timing: 60) — yc_companies
```

This gives the agent thematic structure instead of a flat list.

### 4. Iterative Deepening Execution Flow

Each agent run executes in phases:

**Phase 1 — Broad Scan** (one dual-analyst call):

Input context:
- Clustered signal summaries (N clusters with counts and top representatives)
- All active theses (up to 15)
- Last 5 journal entries (recent reasoning context)
- Trend windows (7d/30d/90d)

Prompt asks:
- What patterns do you see across clusters?
- Which clusters are interesting and why?
- Any thesis confidence updates?
- Which 1-3 topics deserve deeper investigation?

Output: `BroadScanResult`
```typescript
{
  thesis_updates: { canonicalKey, confidence_delta, reasoning }[];
  dig_deeper: { topic, reason, related_cluster_ids }[];
  observations: { type, topic, insight, narrative }[];
}
```

**Phase 2 — Deep Dive** (one dual-analyst call per topic, max 2):

For each "dig deeper" topic:
1. Vector search `signal_embeddings` for related signals (including old ones not in current batch, topK=20)
2. Vector search `agent_journal` for past insights on this topic (topK=10)
3. Load thesis history for related thesis keys

Focused prompt:
- "Here's everything we know about {topic}: current signals, historical signals, your past observations, related theses. What's the real pattern?"
- "Are there connections between these signals that suggest a bigger opportunity?"
- "How has this area evolved since you first noticed it?"

Output: `DeepDiveResult`
```typescript
{
  thesis_updates: { canonicalKey, confidence_delta, reasoning }[];
  new_theses: { title, problem_statement, target_buyer, proposed_solution, supporting_signal_ids }[];
  journal_entries: { type, topic, insight, narrative, confidence, thesis_keys, signal_ids }[];
}
```

**Phase 3 — Commit** (no AI call):
1. Merge thesis updates from both phases (cap confidence_delta to ±20 per phase)
2. Create new thesis candidates
3. Write all journal entries (observations from broad scan + insights from deep dives)
4. Write a `run_summary` journal entry: what was analyzed, what changed, what's next
5. Update agent status

### 5. Journal Consolidation

Every 20 runs (~10 hours), the agent writes a consolidation entry:
- Reads its last 20 `run_summary` entries
- Synthesizes higher-level patterns: "Over the past 10 hours, the dominant trend has been..."
- Entry type: `run_summary` with a flag or longer narrative

This prevents the journal from becoming an unstructured log and builds layered understanding.

### 6. Prompt Templates

**Broad scan prompt structure:**
```
You are Sixth Sense, a SaaS opportunity intelligence system with persistent memory.
You've been analyzing markets continuously. Here's your recent context:

RECENT OBSERVATIONS (your notes from previous runs):
{last 5 journal entries with narratives}

ACTIVE THESES YOU'RE TRACKING:
{theses with confidence, evidence counts, status}

NEW SIGNAL CLUSTERS (since last analysis):
{clustered signals with representatives}

TREND WINDOWS:
{7d/30d/90d aggregates}

ANALYSIS:
1. What patterns do you see across signal clusters?
2. Update confidence for existing theses (delta -20 to +20 with reasoning).
3. Which 1-3 topics should be investigated deeper? Why?
4. Record 2-5 observations for your future self.
```

**Deep dive prompt structure:**
```
You are investigating: "{topic}"

YOUR PAST OBSERVATIONS ON THIS TOPIC:
{journal entries similar to topic}

CURRENT SIGNALS (this cluster):
{full signal details}

HISTORICAL SIGNALS (from vector search):
{older related signals}

RELATED THESES:
{thesis details with evidence history}

DEEP ANALYSIS:
1. What's the real pattern here? Look beyond individual signals.
2. How has this area evolved over time?
3. Should any thesis be updated, created, or merged?
4. Write detailed observations for your future self.
```

### 7. Agent Runner Changes

**Current:** `runResearchAgent({ thesisStore, memoryStore, runClaude, runCodex })`

**New:** `runResearchAgent({ thesisStore, memoryStore, journalStore, runClaude, runCodex })`

New dependencies:
- `journalStore: JournalStore` — read/write journal entries
- `embedText: (text: string) => Promise<number[] | null>` — for embedding journal entries

The agent runner grows from ~120 lines to ~250 lines but the logic is clearly phased.

### 8. Return Type Changes

```typescript
type AgentRunResult = {
  thesesUpdated: number;
  newCandidates: number;
  alerts: string[];
  investigateNext: string;
  journalEntriesWritten: number;  // NEW
  clustersAnalyzed: number;       // NEW
  deepDivesPerformed: number;     // NEW
};
```

## Files

| File | Change |
|------|--------|
| `apps/api/db/migrations/0006_agent_journal.sql` | Create: journal table + indexes |
| `apps/api/src/runtime/journal_store.ts` | Create: PostgresJournalStore |
| `apps/api/src/jobs/signal_clusterer.ts` | Create: greedy cosine clustering |
| `apps/api/src/jobs/agent_runner.ts` | Rewrite: phased execution with journal |
| `apps/api/src/jobs/research_agent.ts` | Rewrite: new prompt templates |
| `apps/api/src/main.ts` | Wire journalStore into agent deps |
| `packages/contracts/src/api.ts` | Update AgentRunResult and AgentStatusRecord |
| `apps/web/src/api.ts` | Update AgentRunResult type |

## Not in Scope

- Exposing journal entries via API/UI (can add later)
- Configurable clustering threshold (hardcode 0.35 for now)
- Multi-language signal support
- External memory (only PostgreSQL)
