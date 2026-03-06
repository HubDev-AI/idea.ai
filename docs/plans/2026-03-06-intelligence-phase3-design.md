# Phase 3: Self-Improving Intelligence — Design Doc

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make idea.ai a system that gets measurably smarter over time — auto-tuning scoring weights from backtesting results, building an experience library of successful predictions, implementing tiered model routing for cost efficiency, and creating a visual startup opportunity map.

**Architecture:** Builds on Phase 1 (Bayesian confidence, velocity, connectors) and Phase 2 (debate, backtesting, category detection, supply/demand). This phase closes the feedback loop and adds the visual and efficiency layers.

**Tech Stack:** TypeScript, PostgreSQL + pgvector, Ollama (expanded role), Claude/Codex CLI

**Prerequisite:** Phase 2 complete (backtesting engine producing validated predictions)

---

## 1. Self-Improving Signal Weights

### Problem

The current scoring weights (demand 25%, timing 20%, buildability 20%, virality 35%) are hand-tuned guesses. Phase 2's backtesting engine produces validated prediction data, but nothing consumes it yet. The system should auto-tune its own weights based on what actually predicted success.

### Design

**Weight optimization via grid search:**

Once the backtesting engine has 50+ validated predictions (roughly 2-3 months of data), run a monthly weight optimization job:

```typescript
type WeightConfig = {
  demand: number;
  timing: number;
  buildability: number;
  virality: number;
  velocity: number;
  corroboration: number;
};

const optimizeWeights = async (
  predictions: ValidatedPrediction[],
  gridStep: number = 0.05
): Promise<{ weights: WeightConfig; precision: number }> => {
  let bestWeights: WeightConfig | null = null;
  let bestPrecision = 0;

  // Grid search over weight combinations that sum to 1.0
  for (const demand of range(0, 0.5, gridStep)) {
    for (const timing of range(0, 0.5, gridStep)) {
      for (const buildability of range(0, 0.4, gridStep)) {
        for (const virality of range(0, 0.5, gridStep)) {
          const velocity = 1 - demand - timing - buildability - virality;
          if (velocity < 0 || velocity > 0.3) continue;

          const weights = { demand, timing, buildability, virality, velocity, corroboration: 0 };
          const precision = computePrecision(predictions, weights);

          if (precision > bestPrecision) {
            bestPrecision = precision;
            bestWeights = weights;
          }
        }
      }
    }
  }

  return { weights: bestWeights!, precision: bestPrecision };
};
```

**Safety rails:**

- Never auto-apply weights — store in `scoring_weight_history` table (from Phase 2 schema)
- Show recommended vs current weights in the UI
- Apply only when precision improvement exceeds 5% over current weights
- Keep a minimum floor for each dimension (no weight below 0.05)
- Log every weight change with the evidence that prompted it

**Configurable:**

```
WEIGHT_OPTIMIZATION_ENABLED=true
WEIGHT_OPTIMIZATION_MIN_PREDICTIONS=50
WEIGHT_OPTIMIZATION_MIN_IMPROVEMENT=0.05
WEIGHT_OPTIMIZATION_GRID_STEP=0.05
```

### Files to modify/create

- `apps/api/src/jobs/weight_optimizer.ts` (new)
- `apps/api/src/main.ts` — schedule monthly optimization
- `apps/api/src/config/env.ts` — optimization config
- `packages/pipeline/src/scoring/blend.ts` — load weights from DB instead of hardcoded

---

## 2. Experience Library (SiriuS-Style)

### Problem

Each agent run starts from scratch — the research agent has no memory of what reasoning patterns worked before. A thesis about "AI agent observability" scored high last month and was later validated by a ProductHunt launch. That successful reasoning trajectory is lost.

### Design

Based on SiriuS (NeurIPS 2025): store successful thesis generation trajectories as few-shot examples for future agent runs.

**Data model:**

```sql
CREATE TABLE experience_library (
  id SERIAL PRIMARY KEY,
  thesis_key TEXT NOT NULL,
  signal_summary TEXT NOT NULL,        -- compressed input signals
  reasoning_trajectory TEXT NOT NULL,  -- the agent's analysis that led to the thesis
  thesis_output TEXT NOT NULL,         -- the generated thesis
  outcome_validated BOOLEAN DEFAULT FALSE,
  validation_details JSONB,
  confidence_at_creation REAL,
  confidence_at_validation REAL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  validated_at TIMESTAMPTZ
);
```

**Population:** When a thesis prediction is validated by the backtesting engine:
1. Retrieve the original agent run that created/promoted the thesis
2. Extract the reasoning trajectory from execution logs
3. Store as a positive example in the experience library

**Usage:** When the research agent generates new theses, include the top 3 most relevant experience library entries as few-shot examples:

```typescript
const buildAgentPrompt = (
  signals: Signal[],
  experiences: ExperienceEntry[]
): string => {
  const examplesSection = experiences.length > 0
    ? [
        'Here are examples of thesis analyses that were later validated by the market:',
        ...experiences.map((e, i) =>
          `Example ${i + 1}:\nSignals: ${e.signal_summary}\nAnalysis: ${e.reasoning_trajectory}\nThesis: ${e.thesis_output}\nOutcome: Validated`
        ),
        '',
        'Use these successful patterns as guidance for your analysis.',
      ].join('\n')
    : '';

  return [
    AGENT_SYSTEM_PROMPT,
    examplesSection,
    'Current signals to analyze:',
    JSON.stringify(signals),
  ].join('\n');
};
```

**Retrieval:** Use embedding similarity between current signal cluster and stored `signal_summary` to find the most relevant experiences.

**Failed trajectory repair (advanced):**

When a thesis is NOT validated (predicted success but nothing happened), store it as a negative example. Extract what went wrong:

```typescript
// After 90 days with no validation:
{
  thesis_key: 'consumer:ai-code-review',
  outcome_validated: false,
  validation_details: {
    reason: 'market_saturated',
    evidence: '15+ products launched in this space',
    lesson: 'High signal volume from developer sources does not indicate opportunity when supply already high'
  }
}
```

Include 1-2 negative examples alongside positive ones to help the agent avoid past mistakes.

### Files to modify/create

- `apps/api/db/migrations/0018_experience_library.sql` (new)
- `apps/api/src/runtime/experience_store.ts` (new)
- `apps/api/src/jobs/research_agent.ts` — inject experiences into agent prompt
- `apps/api/src/jobs/backtest_validate.ts` — populate experience library on validation

---

## 3. Tiered Model Routing

### Problem

Every AI call currently uses Claude or Codex CLI, which are slow and expensive (rate-limited by CLI subscription). Many tasks don't need frontier intelligence — signal classification, dedup checking, entity extraction, and basic scoring can run on small local models via Ollama.

### Design

**Task classification:**

| Task | Model Tier | Provider |
|------|-----------|----------|
| Signal noise classification | Cheap | Ollama (Llama 3.2 3B) |
| Signal deduplication check | Cheap | Ollama (Llama 3.2 3B) |
| Entity extraction (pain/tech/market) | Cheap | Ollama (Qwen 2.5 7B) |
| Basic demand/timing scoring | Medium | Ollama (Qwen 2.5 7B) |
| Thesis synthesis | Expensive | Claude CLI |
| Adversarial debate | Expensive | Claude + Codex CLI |
| Deep dive generation | Expensive | Claude CLI |
| Buildability judge scoring | Medium | Claude CLI (with Ollama fallback) |

**Router implementation:**

```typescript
type ModelTier = 'cheap' | 'medium' | 'expensive';

type ModelRoute = {
  tier: ModelTier;
  ollamaModel?: string;
  fallbackToCliProvider?: boolean;
};

const TASK_ROUTES: Record<string, ModelRoute> = {
  noise_classification: { tier: 'cheap', ollamaModel: 'llama3.2:3b' },
  dedup_check: { tier: 'cheap', ollamaModel: 'llama3.2:3b' },
  entity_extraction: { tier: 'cheap', ollamaModel: 'qwen2.5:7b' },
  basic_scoring: { tier: 'medium', ollamaModel: 'qwen2.5:7b', fallbackToCliProvider: true },
  thesis_synthesis: { tier: 'expensive' },
  debate: { tier: 'expensive' },
  deep_dive: { tier: 'expensive' },
};

const routeTask = async (task: string, prompt: string): Promise<string> => {
  const route = TASK_ROUTES[task];
  if (!route) return runCliProvider(prompt);

  if (route.tier === 'expensive') {
    return runCliProvider(prompt);
  }

  try {
    return await runOllamaPrompt(prompt, route.ollamaModel!);
  } catch {
    if (route.fallbackToCliProvider) {
      return runCliProvider(prompt);
    }
    throw new Error(`Ollama failed for task ${task} and no fallback configured`);
  }
};
```

**Ollama prompt runner:**

```typescript
const runOllamaPrompt = async (
  prompt: string,
  model: string,
  timeoutMs: number = 30_000
): Promise<string> => {
  const res = await fetch(`${ollamaBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = await res.json() as { response: string };
  return data.response;
};
```

**Expected cost reduction:** 60-70% fewer CLI calls. The noise gate alone (Tier 1 in the original V2 design) would eliminate ~60% of signals before they reach expensive scoring.

**Configurable:**

```
MODEL_ROUTING_ENABLED=true
OLLAMA_CHEAP_MODEL=llama3.2:3b
OLLAMA_MEDIUM_MODEL=qwen2.5:7b
OLLAMA_TASK_TIMEOUT_MS=30000
```

### Files to modify/create

- `packages/ai-runtime/src/ollama_prompt.ts` (new) — Ollama text generation
- `packages/ai-runtime/src/router.ts` (new) — task-based model routing
- `apps/api/src/jobs/ai_post_scrape.ts` — use router for noise classification
- `apps/api/src/jobs/ai_judges.ts` — use router for basic scoring
- `apps/api/src/config/env.ts` — routing config

---

## 4. Entity-Relationship Knowledge Graph

### Problem

The current system treats signals as independent data points connected only by embedding similarity. It cannot reason about causal chains: "pain point X exists + no competitor addresses it + technology Y just matured = opportunity." This multi-hop reasoning requires an entity-relationship model.

### Design

**Entity types:**

```sql
CREATE TABLE entities (
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

CREATE TABLE entity_relations (
  id SERIAL PRIMARY KEY,
  source_entity_id INTEGER REFERENCES entities(id),
  target_entity_id INTEGER REFERENCES entities(id),
  relation_type TEXT NOT NULL CHECK (relation_type IN (
    'causes', 'enables', 'competes_with', 'addresses', 'depends_on', 'part_of'
  )),
  confidence REAL DEFAULT 0.5,
  evidence_signal_ids TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_entity_id, target_entity_id, relation_type)
);
```

**Entity extraction:**

Use the tiered model router (Ollama for cheap extraction):

```typescript
const ENTITY_EXTRACTION_PROMPT = `Extract entities from this signal. Return JSON:
{
  "entities": [
    {"type": "pain_point", "name": "...", "description": "..."},
    {"type": "technology", "name": "...", "description": "..."}
  ],
  "relations": [
    {"source": "pain_point:X", "target": "technology:Y", "relation": "addresses"}
  ]
}

Signal: {text}`;
```

Run on every scored signal using the cheap Ollama tier. Store extracted entities and relations.

**Opportunity pattern detection:**

The research agent can query the knowledge graph for opportunity patterns:

```sql
-- Pain points with no competitor addressing them
SELECT p.name AS pain, p.mention_count
FROM entities p
LEFT JOIN entity_relations r ON r.source_entity_id = p.id AND r.relation_type = 'addresses'
LEFT JOIN entities c ON c.id = r.target_entity_id AND c.entity_type = 'competitor'
WHERE p.entity_type = 'pain_point'
  AND p.mention_count > 5
  AND c.id IS NULL
ORDER BY p.mention_count DESC;

-- Technologies that enable new products but have no products built on them yet
SELECT t.name AS tech, t.mention_count
FROM entities t
LEFT JOIN entity_relations r ON r.target_entity_id = t.id AND r.relation_type = 'depends_on'
WHERE t.entity_type = 'technology'
  AND t.mention_count > 10
  AND NOT EXISTS (
    SELECT 1 FROM entity_relations r2
    JOIN entities prod ON prod.id = r2.source_entity_id
    WHERE r2.target_entity_id = t.id
    AND r2.relation_type = 'depends_on'
    AND prod.entity_type = 'competitor'
  )
ORDER BY t.mention_count DESC;
```

**Graph context in agent prompts:**

Include relevant graph context when the agent synthesizes theses:

```
Related entities for this cluster:
- Pain: "multi-tenant DB migrations" (mentioned 47 times, growing)
- Technology: "Prisma" (dependency of 12 related signals)
- Competitors: none found addressing this specific pain
- Related market: "DevOps" (mature but fragmenting into sub-categories)

Causal chain: developers struggle with multi-tenant migrations →
Prisma doesn't handle it → no dedicated tool exists → opportunity
```

### Files to modify/create

- `apps/api/db/migrations/0019_knowledge_graph.sql` (new)
- `apps/api/src/runtime/entity_store.ts` (new) — entity CRUD + graph queries
- `apps/api/src/jobs/entity_extractor.ts` (new) — LLM entity extraction pipeline
- `apps/api/src/jobs/research_agent.ts` — inject graph context into synthesis

---

## 5. Startup Opportunity Map (Visual)

### Problem

The dashboard shows a flat list of theses. Founders need to see the landscape — which markets are forming, where the white space is, and how opportunities relate to each other.

### Design

**Data structure:**

```typescript
type OpportunityNode = {
  id: string;
  label: string;
  type: 'market' | 'category' | 'thesis';
  confidence: number;
  velocity: number;
  supply: number;         // existing products count
  demand: number;         // signal count
  children?: OpportunityNode[];
};

type OpportunityMap = {
  roots: OpportunityNode[];
  generatedAt: string;
};
```

**Generation:** The research agent produces the map structure after thesis synthesis:

```
AI Agents (market)
  ├── Agent Memory (category, emerging)
  │    ├── Vector memory for agents (thesis, 74% confidence)
  │    └── Persistent agent state (thesis, 61% confidence)
  ├── Agent Orchestration (category, growing)
  │    ├── Multi-agent coordination platform (thesis, 68%)
  │    └── Agent debugging/observability (thesis, 82%)
  └── Agent Hosting (category, early)
       └── Serverless agent runtime (thesis, 45%)
```

**API endpoint:**

```
GET /v1/opportunity-map
```

Returns the tree structure. Refreshed on each agent run.

**Frontend visualization:**

A collapsible tree view where:
- Node size = confidence
- Node color = velocity (green = accelerating, yellow = stable, red = declining)
- Badge = supply/demand imbalance quadrant
- Click to expand → shows supporting signals and debate summary

Use a simple nested `<div>` tree layout (no D3.js dependency — keep it lightweight). The existing CSS system can handle this with indentation and color classes.

### Files to modify/create

- `packages/contracts/src/api.ts` — `OpportunityMap` and `OpportunityNode` types
- `apps/api/src/routes/opportunity_map.ts` (new)
- `apps/api/src/jobs/research_agent.ts` — generate map structure
- `apps/web/src/components/OpportunityMap.tsx` (new)
- `apps/web/src/styles.css` — map visualization styles

---

## Success Criteria

1. Scoring weights auto-improve based on backtesting data (precision increases over time)
2. Experience library entries visibly improve agent output quality
3. 60%+ reduction in CLI AI calls via model routing
4. Knowledge graph enables multi-hop opportunity reasoning
5. Opportunity map provides an at-a-glance view of market white space
6. All improvements are measurable — precision/recall tracked and logged
7. System runs unattended with self-correcting behavior

---

## Risks

| Risk | Mitigation |
|------|------------|
| Weight optimization overfits to small sample | Require 50+ predictions minimum; use holdout validation |
| Experience library biases toward past patterns | Include negative examples; cap at 5 experiences per prompt |
| Ollama models too slow for batch processing | Pipeline tasks; increase Ollama timeout; batch multiple signals per call |
| Entity extraction quality inconsistent | Use structured JSON output; validate schema; discard malformed entries |
| Knowledge graph grows unbounded | Prune entities not seen in 90 days; merge near-duplicate entities |
| Opportunity map becomes overwhelming | Limit to top 5 markets, 3 categories each, 3 theses each |

---

## Long-Term Vision

After Phase 3, idea.ai becomes:

1. **Self-improving** — scoring gets more accurate over time, provably
2. **Cost-efficient** — cheap models handle grunt work, expensive models do reasoning
3. **Causally aware** — understands *why* opportunities exist, not just *that* they exist
4. **Visually navigable** — founders see the opportunity landscape at a glance
5. **Evidence-backed** — every thesis has a debate transcript, signal chain, and prediction history

This creates a genuine data moat: the longer the system runs, the better it gets, and the harder it is to replicate.
