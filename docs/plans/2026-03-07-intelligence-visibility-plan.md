# Phase 4: Intelligence Visibility — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire dormant Phase 3 infrastructure into the live pipeline and surface all hidden intelligence data through new UI tabs and drawers.

**Architecture:** Four vertical slices, each closing one backend feedback loop AND shipping its corresponding UI. All changes are additive — no existing routes, components, or pipeline behavior is modified. New drawer tabs are added alongside Opportunity Map and Logs. A new modal tab is added inside the existing ThesisDeepDiveModal.

**Tech Stack:** Fastify routes, PostgreSQL queries, React 18 components, custom CSS, Socket.IO for live updates, Ollama for cheap/medium AI tasks via model router.

---

## Slice 1: Score Explainability

### Task 1: ThesisExplainRecord contract type

**Files:**
- Modify: `packages/contracts/src/api.ts`

**Step 1: Add the type**

Add after `ThesisDeepDive` type (around line 160):

```typescript
export type ThesisExplainRecord = {
  weightBreakdown: {
    demand: { score: number; weight: number; contribution: number };
    timing: { score: number; weight: number; contribution: number };
    buildability: { score: number; weight: number; contribution: number };
    virality: { score: number; weight: number; contribution: number };
    blended: number;
    weightsSource: 'optimized' | 'default';
  };
  debate: {
    bullCase: string;
    bearCase: string;
    verdict: string;
    confidence: number;
    bullStrength: number;
    bearStrength: number;
    missingEvidence: string[];
    debatedAt: string;
  } | null;
  bayesianTrail: {
    prior: number;
    posterior: number;
    updates: { source: string; delta: number; at: string }[];
  };
  topEvidence: {
    signalId: string;
    text: string;
    source: string;
    score: number;
  }[];
};
```

**Step 2: Commit**

```bash
git add packages/contracts/src/api.ts
git commit -m "feat(contracts): add ThesisExplainRecord type"
```

---

### Task 2: Explain API route

**Files:**
- Create: `apps/api/src/routes/thesis_explain.ts`
- Create: `apps/api/tests/thesis_explain.test.ts`

**Step 1: Write the test**

```typescript
// apps/api/tests/thesis_explain.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { registerThesisExplainRoute } from '../src/routes/thesis_explain';

describe('GET /v1/theses/:key/explain', () => {
  it('returns 404 for unknown thesis', async () => {
    const app = Fastify();
    registerThesisExplainRoute(app, {
      thesisStore: { getByKey: async () => null } as any,
      pool: null,
    });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/v1/theses/unknown/explain' });
    expect(res.statusCode).toBe(404);
  });

  it('returns explain record for known thesis', async () => {
    const app = Fastify();
    const mockThesis = {
      canonicalKey: 'consumer:test',
      title: 'Test',
      confidence: 72,
      avgDemand: 80,
      avgTiming: 60,
      avgBuildability: 70,
      avgVirality: 50,
      velocity: 1.2,
      posteriorConfidence: 72,
      profileId: 'consumer',
      evidence: [
        { signal_id: 's1', snippet: 'signal text', relation: 'supporting', weight: 1, observed_at: '2026-01-01' }
      ],
    };
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
    registerThesisExplainRoute(app, {
      thesisStore: { getByKey: async () => mockThesis } as any,
      pool: mockPool as any,
    });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/v1/theses/consumer:test/explain' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.weightBreakdown).toBeDefined();
    expect(body.weightBreakdown.blended).toBeGreaterThan(0);
    expect(body.debate).toBeNull(); // no debates in mock
    expect(body.topEvidence).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api && pnpm exec vitest run tests/thesis_explain.test.ts
```
Expected: FAIL — module not found.

**Step 3: Write the route implementation**

```typescript
// apps/api/src/routes/thesis_explain.ts
import type { ThesisExplainRecord } from '@idea/contracts/src/api';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { ThesisStore } from '../runtime/thesis_store';

export type ThesisExplainDeps = {
  thesisStore: ThesisStore;
  pool: Pool | null;
  getActiveWeights?: (profileId: string) => Promise<{ demand: number; timing: number; buildability: number; virality: number; source: 'optimized' | 'default' }>;
};

const DEFAULT_WEIGHTS: Record<string, { demand: number; timing: number; buildability: number; virality: number }> = {
  consumer: { demand: 0.25, timing: 0.20, buildability: 0.20, virality: 0.35 },
  b2b: { demand: 0.30, timing: 0.25, buildability: 0.25, virality: 0.20 },
};

export const registerThesisExplainRoute = (
  app: FastifyInstance,
  deps: ThesisExplainDeps
): void => {
  app.get('/v1/theses/:key/explain', async (request, reply) => {
    const { key } = request.params as { key: string };
    const thesis = await deps.thesisStore.getByKey(key);
    if (!thesis) return reply.code(404).send({ error: 'Thesis not found' });

    const profileId = (thesis as any).profileId ?? 'consumer';

    // Weight breakdown
    let weights: { demand: number; timing: number; buildability: number; virality: number };
    let weightsSource: 'optimized' | 'default' = 'default';
    if (deps.getActiveWeights) {
      const active = await deps.getActiveWeights(profileId);
      weights = active;
      weightsSource = active.source;
    } else {
      weights = DEFAULT_WEIGHTS[profileId] ?? DEFAULT_WEIGHTS.consumer;
    }

    const d = thesis.avgDemand ?? 0;
    const t = thesis.avgTiming ?? 0;
    const b = thesis.avgBuildability ?? 0;
    const v = thesis.avgVirality ?? 0;
    const blended = Math.round(
      (weights.demand * d + weights.timing * t + weights.buildability * b + weights.virality * v) * 100
    ) / 100;

    // Debate history
    let debate: ThesisExplainRecord['debate'] = null;
    if (deps.pool) {
      const { rows } = await deps.pool.query(
        `SELECT bull_case, bear_case, moderator_verdict, created_at
         FROM thesis_debates WHERE thesis_key = $1
         ORDER BY created_at DESC LIMIT 1`,
        [key]
      );
      if (rows.length > 0) {
        const row = rows[0] as any;
        const verdict = typeof row.moderator_verdict === 'string'
          ? JSON.parse(row.moderator_verdict)
          : row.moderator_verdict;
        debate = {
          bullCase: row.bull_case,
          bearCase: row.bear_case,
          verdict: verdict.verdict ?? 'unknown',
          confidence: verdict.confidence ?? 0,
          bullStrength: verdict.bull_strength ?? 0,
          bearStrength: verdict.bear_strength ?? 0,
          missingEvidence: verdict.missing_evidence ?? [],
          debatedAt: row.created_at,
        };
      }
    }

    // Bayesian trail from debate history
    const updates: ThesisExplainRecord['bayesianTrail']['updates'] = [];
    if (deps.pool) {
      const { rows } = await deps.pool.query(
        `SELECT moderator_verdict, created_at
         FROM thesis_debates WHERE thesis_key = $1
         ORDER BY created_at ASC`,
        [key]
      );
      for (const row of rows as any[]) {
        const v = typeof row.moderator_verdict === 'string'
          ? JSON.parse(row.moderator_verdict)
          : row.moderator_verdict;
        const verdictLabel = v.verdict ?? 'unknown';
        const delta = verdictLabel === 'strong_opportunity' ? 5
          : verdictLabel === 'needs_investigation' ? 2
          : verdictLabel === 'contested' ? -2
          : -5;
        updates.push({ source: `debate:${verdictLabel}`, delta, at: row.created_at });
      }
    }

    // Top evidence signals
    const topEvidence: ThesisExplainRecord['topEvidence'] = [];
    if (thesis.evidence && Array.isArray(thesis.evidence)) {
      for (const e of thesis.evidence.slice(0, 5)) {
        const ev = e as any;
        topEvidence.push({
          signalId: ev.signal_id ?? '',
          text: ev.snippet ?? '',
          source: ev.source ?? '',
          score: ev.weight ?? 0,
        });
      }
    }

    const record: ThesisExplainRecord = {
      weightBreakdown: {
        demand: { score: d, weight: weights.demand, contribution: Math.round(weights.demand * d * 100) / 100 },
        timing: { score: t, weight: weights.timing, contribution: Math.round(weights.timing * t * 100) / 100 },
        buildability: { score: b, weight: weights.buildability, contribution: Math.round(weights.buildability * b * 100) / 100 },
        virality: { score: v, weight: weights.virality, contribution: Math.round(weights.virality * v * 100) / 100 },
        blended,
        weightsSource,
      },
      debate,
      bayesianTrail: {
        prior: thesis.confidence - updates.reduce((sum, u) => sum + u.delta, 0),
        posterior: thesis.confidence,
        updates,
      },
      topEvidence,
    };

    return record;
  });
};
```

**Step 4: Run test to verify it passes**

```bash
cd apps/api && pnpm exec vitest run tests/thesis_explain.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/routes/thesis_explain.ts apps/api/tests/thesis_explain.test.ts
git commit -m "feat: add /v1/theses/:key/explain route with weight breakdown and debate history"
```

---

### Task 3: Register explain route in server

**Files:**
- Modify: `apps/api/src/server.ts`

**Step 1: Add import and registration**

At the top of `server.ts`, add:
```typescript
import { registerThesisExplainRoute } from './routes/thesis_explain';
```

Inside `buildServer`, after the `registerThesesRoute` block (around line 160), add:
```typescript
if (resolvedDeps.thesisStore) {
  registerThesisExplainRoute(app, {
    thesisStore: resolvedDeps.thesisStore,
    pool: resolvedDeps.pool ?? null,
  });
}
```

**Step 2: Run all tests**

```bash
cd apps/api && CI=1 pnpm test
```
Expected: All tests pass.

**Step 3: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "feat: register thesis explain route in server"
```

---

### Task 4: Frontend API client for explain

**Files:**
- Modify: `apps/web/src/api.ts`

**Step 1: Add type re-export and fetch function**

At the top of `api.ts`, add `ThesisExplainRecord` to the import from contracts:
```typescript
import type { ..., ThesisExplainRecord } from '@idea/contracts/src/api';
```

Add to the re-exports:
```typescript
export type { ..., ThesisExplainRecord };
```

Add the fetch function at the bottom:
```typescript
export const fetchThesisExplain = async (canonicalKey: string): Promise<ThesisExplainRecord> => {
  const response = await fetch(buildApiUrl(`/v1/theses/${encodeURIComponent(canonicalKey)}/explain`));
  if (!response.ok) throw new Error(`fetchThesisExplain failed: ${response.status}`);
  return response.json() as Promise<ThesisExplainRecord>;
};
```

**Step 2: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat: add fetchThesisExplain API client"
```

---

### Task 5: ThesisExplainTab component

**Files:**
- Create: `apps/web/src/components/ThesisExplainTab.tsx`

**Step 1: Create the component**

```typescript
import React, { useEffect, useState } from 'react';
import type { ThesisExplainRecord } from '../api';
import { fetchThesisExplain } from '../api';

type Props = { canonicalKey: string };

const verdictColor = (v: string): string => {
  if (v === 'strong_opportunity') return 'var(--ok)';
  if (v === 'needs_investigation') return 'var(--warn)';
  if (v === 'contested') return 'var(--warn)';
  return 'var(--error)';
};

export const ThesisExplainTab: React.FC<Props> = ({ canonicalKey }) => {
  const [data, setData] = useState<ThesisExplainRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchThesisExplain(canonicalKey)
      .then(d => { if (!cancelled) setData(d); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [canonicalKey]);

  if (error) return <div className="explain-error">Failed to load: {error}</div>;
  if (!data) return <div className="explain-loading">Loading score breakdown...</div>;

  const wb = data.weightBreakdown;
  const dims = [
    { name: 'Demand', ...wb.demand },
    { name: 'Timing', ...wb.timing },
    { name: 'Buildability', ...wb.buildability },
    { name: 'Virality', ...wb.virality },
  ];
  const maxContribution = Math.max(...dims.map(d => d.contribution), 1);

  return (
    <div className="explain-tab">
      <section className="explain-section">
        <h4>Weight Breakdown</h4>
        <span className="explain-weights-source">{wb.weightsSource}</span>
        <div className="explain-bars">
          {dims.map(d => (
            <div key={d.name} className="explain-bar-row">
              <span className="explain-bar-label">{d.name}</span>
              <div className="explain-bar-track">
                <div
                  className="explain-bar-fill"
                  style={{ width: `${(d.contribution / maxContribution) * 100}%` }}
                />
              </div>
              <span className="explain-bar-value">
                {d.score.toFixed(0)} x {(d.weight * 100).toFixed(0)}% = {d.contribution.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
        <div className="explain-blended">Blended: {wb.blended.toFixed(1)}</div>
      </section>

      {data.debate && (
        <section className="explain-section">
          <h4>Latest Debate</h4>
          <div className="explain-debate">
            <div className="explain-debate-case bull">
              <h5>Bull Case</h5>
              <p>{data.debate.bullCase}</p>
              <span className="explain-strength">Strength: {data.debate.bullStrength}/100</span>
            </div>
            <div className="explain-debate-case bear">
              <h5>Bear Case</h5>
              <p>{data.debate.bearCase}</p>
              <span className="explain-strength">Strength: {data.debate.bearStrength}/100</span>
            </div>
          </div>
          <div className="explain-verdict" style={{ borderColor: verdictColor(data.debate.verdict) }}>
            <span className="explain-verdict-label" style={{ color: verdictColor(data.debate.verdict) }}>
              {data.debate.verdict.replace(/_/g, ' ')}
            </span>
            <span className="explain-verdict-confidence">
              Confidence: {(data.debate.confidence * 100).toFixed(0)}%
            </span>
          </div>
          {data.debate.missingEvidence.length > 0 && (
            <div className="explain-missing">
              <h5>Missing Evidence</h5>
              <ul>
                {data.debate.missingEvidence.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="explain-section">
        <h4>Confidence Trail</h4>
        <div className="explain-trail">
          <span className="explain-trail-prior">Prior: {data.bayesianTrail.prior.toFixed(0)}</span>
          {data.bayesianTrail.updates.map((u, i) => (
            <span key={i} className={`explain-trail-update ${u.delta >= 0 ? 'positive' : 'negative'}`}>
              {u.delta >= 0 ? '+' : ''}{u.delta} ({u.source})
            </span>
          ))}
          <span className="explain-trail-posterior">Posterior: {data.bayesianTrail.posterior.toFixed(0)}</span>
        </div>
      </section>

      {data.topEvidence.length > 0 && (
        <section className="explain-section">
          <h4>Top Evidence</h4>
          <ul className="explain-evidence-list">
            {data.topEvidence.map((e, i) => (
              <li key={i} className="explain-evidence-item">
                <span className="explain-evidence-source">{e.source}</span>
                <span className="explain-evidence-text">{e.text || '(no snippet)'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add apps/web/src/components/ThesisExplainTab.tsx
git commit -m "feat: add ThesisExplainTab component"
```

---

### Task 6: Wire explain tab into deep-dive modal

**Files:**
- Modify: `apps/web/src/components/ThesisDeepDiveModal.tsx`

**Step 1: Add import and tab state**

Add import at top:
```typescript
import { ThesisExplainTab } from './ThesisExplainTab';
```

Add tab state inside the component (after existing `useState` calls):
```typescript
const [activeTab, setActiveTab] = useState<'deep-dive' | 'explain'>('deep-dive');
```

**Step 2: Add tab buttons in header**

Inside the `deep-dive-header` div, after the title `<h2>`, add:
```tsx
<div className="deep-dive-tabs">
  <button
    type="button"
    className={`deep-dive-tab ${activeTab === 'deep-dive' ? 'active' : ''}`}
    onClick={() => setActiveTab('deep-dive')}
  >
    Deep Dive
  </button>
  <button
    type="button"
    className={`deep-dive-tab ${activeTab === 'explain' ? 'active' : ''}`}
    onClick={() => setActiveTab('explain')}
  >
    Why this score?
  </button>
</div>
```

**Step 3: Wrap existing content in tab conditional**

Wrap the existing `{loading && ...}`, `{error && ...}`, and `{data && ...}` blocks:
```tsx
{activeTab === 'deep-dive' && (
  <>
    {loading && (/* existing loading JSX */)}
    {error && (/* existing error JSX */)}
    {data && (/* existing content JSX */)}
  </>
)}
{activeTab === 'explain' && (
  <ThesisExplainTab canonicalKey={thesis.canonicalKey} />
)}
```

**Step 4: Commit**

```bash
git add apps/web/src/components/ThesisDeepDiveModal.tsx
git commit -m "feat: add 'Why this score?' tab to deep-dive modal"
```

---

### Task 7: CSS for explain tab

**Files:**
- Modify: `apps/web/src/styles.css`

**Step 1: Add styles at end of file**

```css
/* --- Explain Tab --- */
.deep-dive-tabs {
  display: flex;
  gap: 0;
  margin-top: 0.5rem;
}
.deep-dive-tab {
  background: transparent;
  border: 1px solid var(--glass-border);
  border-bottom: none;
  color: var(--muted);
  padding: 0.4rem 1rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.deep-dive-tab.active {
  color: var(--text-primary);
  background: var(--surface-2);
  border-bottom: 2px solid var(--accent);
}
.explain-tab { padding: 1rem 0; }
.explain-section { margin-bottom: 1.5rem; }
.explain-section h4 {
  font-size: 0.9rem;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}
.explain-weights-source {
  font-size: 0.75rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.explain-bars { display: flex; flex-direction: column; gap: 0.4rem; margin-top: 0.5rem; }
.explain-bar-row { display: flex; align-items: center; gap: 0.5rem; }
.explain-bar-label { width: 5rem; font-size: 0.8rem; color: var(--muted); }
.explain-bar-track {
  flex: 1;
  height: 8px;
  background: var(--glass-border);
  border-radius: 4px;
  overflow: hidden;
}
.explain-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
  transition: width 0.3s;
}
.explain-bar-value { width: 8rem; font-size: 0.75rem; color: var(--muted); text-align: right; }
.explain-blended {
  margin-top: 0.5rem;
  font-weight: 600;
  font-size: 1rem;
  color: var(--text-primary);
}
.explain-debate { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.explain-debate-case {
  padding: 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--glass-border);
  font-size: 0.8rem;
  color: var(--text-secondary);
}
.explain-debate-case.bull { border-left: 3px solid var(--ok); }
.explain-debate-case.bear { border-left: 3px solid var(--error); }
.explain-debate-case h5 { margin: 0 0 0.5rem; font-size: 0.85rem; color: var(--text-primary); }
.explain-debate-case p { margin: 0 0 0.5rem; line-height: 1.5; }
.explain-strength { font-size: 0.7rem; color: var(--muted); }
.explain-verdict {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid;
  border-radius: 6px;
}
.explain-verdict-label { font-weight: 600; text-transform: capitalize; font-size: 0.85rem; }
.explain-verdict-confidence { font-size: 0.8rem; color: var(--muted); }
.explain-missing { margin-top: 0.5rem; }
.explain-missing h5 { font-size: 0.8rem; color: var(--muted); margin-bottom: 0.25rem; }
.explain-missing ul { padding-left: 1.2rem; }
.explain-missing li { font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.2rem; }
.explain-trail {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
  font-size: 0.8rem;
}
.explain-trail-prior, .explain-trail-posterior {
  font-weight: 600;
  color: var(--text-primary);
}
.explain-trail-update {
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  font-size: 0.75rem;
}
.explain-trail-update.positive { background: rgba(74, 222, 128, 0.15); color: var(--ok); }
.explain-trail-update.negative { background: rgba(248, 113, 113, 0.15); color: var(--error); }
.explain-evidence-list { list-style: none; padding: 0; }
.explain-evidence-item {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--glass-border);
  font-size: 0.8rem;
}
.explain-evidence-source {
  color: var(--accent);
  font-weight: 500;
  white-space: nowrap;
  min-width: 5rem;
}
.explain-evidence-text { color: var(--text-secondary); }
.explain-loading, .explain-error { padding: 2rem; text-align: center; color: var(--muted); }
```

**Step 2: Commit**

```bash
git add apps/web/src/styles.css
git commit -m "feat: add explain tab CSS styles"
```

---

### Task 8: Slice 1 integration test

**Step 1: Run all tests**

```bash
CI=1 pnpm test
```
Expected: All tests pass.

**Step 2: Commit slice 1 complete**

No additional commit needed if all tests pass. This is a verification step only.

---

## Slice 2: Self-Improving Weights

### Task 9: getActiveWeights query function

**Files:**
- Create: `apps/api/src/runtime/active_weights.ts`
- Create: `apps/api/tests/active_weights.test.ts`

**Step 1: Write the test**

```typescript
// apps/api/tests/active_weights.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getActiveWeights, PROFILE_DEFAULT_WEIGHTS } from '../src/runtime/active_weights';

describe('getActiveWeights', () => {
  it('returns default weights when no DB rows', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await getActiveWeights(pool as any, 'consumer');
    expect(result.source).toBe('default');
    expect(result.demand).toBe(0.25);
    expect(result.virality).toBe(0.35);
  });

  it('returns optimized weights when DB has better result', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ demand_weight: 0.30, timing_weight: 0.20, buildability_weight: 0.15, virality_weight: 0.35 }]
      })
    };
    const result = await getActiveWeights(pool as any, 'consumer');
    expect(result.source).toBe('optimized');
    expect(result.demand).toBe(0.30);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api && pnpm exec vitest run tests/active_weights.test.ts
```

**Step 3: Write the implementation**

```typescript
// apps/api/src/runtime/active_weights.ts
import type { Pool } from 'pg';

export type ActiveWeights = {
  demand: number;
  timing: number;
  buildability: number;
  virality: number;
  source: 'optimized' | 'default';
};

export const PROFILE_DEFAULT_WEIGHTS: Record<string, Omit<ActiveWeights, 'source'>> = {
  consumer: { demand: 0.25, timing: 0.20, buildability: 0.20, virality: 0.35 },
  b2b: { demand: 0.30, timing: 0.25, buildability: 0.25, virality: 0.20 },
};

export const getActiveWeights = async (pool: Pool, _profileId: string): Promise<ActiveWeights> => {
  try {
    const { rows } = await pool.query<{
      demand_weight: number;
      timing_weight: number;
      buildability_weight: number;
      virality_weight: number;
    }>(
      `SELECT demand_weight, timing_weight, buildability_weight, virality_weight
       FROM scoring_weight_history
       ORDER BY computed_at DESC
       LIMIT 1`
    );
    if (rows.length > 0) {
      const row = rows[0];
      return {
        demand: row.demand_weight,
        timing: row.timing_weight,
        buildability: row.buildability_weight,
        virality: row.virality_weight,
        source: 'optimized',
      };
    }
  } catch {
    // DB may not have table yet — fall through to defaults
  }

  const defaults = PROFILE_DEFAULT_WEIGHTS[_profileId] ?? PROFILE_DEFAULT_WEIGHTS.consumer;
  return { ...defaults, source: 'default' };
};
```

**Step 4: Run test to verify it passes**

```bash
cd apps/api && pnpm exec vitest run tests/active_weights.test.ts
```

**Step 5: Commit**

```bash
git add apps/api/src/runtime/active_weights.ts apps/api/tests/active_weights.test.ts
git commit -m "feat: add getActiveWeights with DB lookup and profile defaults"
```

---

### Task 10: ScoringHealthRecord contract type and API route

**Files:**
- Modify: `packages/contracts/src/api.ts`
- Create: `apps/api/src/routes/scoring_health.ts`
- Create: `apps/api/tests/scoring_health.test.ts`

**Step 1: Add contract type**

Add to `packages/contracts/src/api.ts`:

```typescript
export type ScoringHealthRecord = {
  currentWeights: {
    profileId: string;
    demand: number;
    timing: number;
    buildability: number;
    virality: number;
    source: 'optimized' | 'default';
  };
  optimizationHistory: {
    computedAt: string;
    demand: number;
    timing: number;
    buildability: number;
    virality: number;
    precision: number | null;
    sampleSize: number | null;
  }[];
  predictionTrackRecord: {
    total: number;
    validated: number;
    accuracy: number | null;
  };
  experienceLibrarySize: number;
};
```

**Step 2: Write the test**

```typescript
// apps/api/tests/scoring_health.test.ts
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerScoringHealthRoute } from '../src/routes/scoring_health';

describe('GET /v1/scoring-health', () => {
  it('returns scoring health data', async () => {
    const app = Fastify();
    const mockPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // weight history
        .mockResolvedValueOnce({ rows: [{ total: '5', validated: '2' }] }) // predictions
        .mockResolvedValueOnce({ rows: [{ count: '3' }] }) // experience count
    };
    registerScoringHealthRoute(app, {
      pool: mockPool as any,
      getActiveWeights: async () => ({
        demand: 0.25, timing: 0.20, buildability: 0.20, virality: 0.35, source: 'default' as const
      }),
    });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/v1/scoring-health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.currentWeights.source).toBe('default');
    expect(body.predictionTrackRecord.total).toBe(5);
    expect(body.experienceLibrarySize).toBe(3);
  });
});
```

**Step 3: Write route implementation**

```typescript
// apps/api/src/routes/scoring_health.ts
import type { ScoringHealthRecord } from '@idea/contracts/src/api';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { ActiveWeights } from '../runtime/active_weights';

export type ScoringHealthDeps = {
  pool: Pool;
  getActiveWeights: (profileId: string) => Promise<ActiveWeights>;
};

export const registerScoringHealthRoute = (
  app: FastifyInstance,
  deps: ScoringHealthDeps
): void => {
  app.get('/v1/scoring-health', async (request) => {
    const query = request.query as { profile?: string };
    const profileId = query.profile ?? 'consumer';
    const weights = await deps.getActiveWeights(profileId);

    const [historyResult, predResult, expResult] = await Promise.all([
      deps.pool.query(
        `SELECT computed_at, demand_weight, timing_weight, buildability_weight,
                virality_weight, precision_score, sample_size
         FROM scoring_weight_history
         ORDER BY computed_at DESC
         LIMIT 20`
      ),
      deps.pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE outcome_validated = TRUE)::int AS validated
         FROM thesis_predictions
         WHERE outcome_checked_at IS NOT NULL`
      ),
      deps.pool.query(`SELECT COUNT(*)::int AS count FROM experience_library`),
    ]);

    const history = historyResult.rows.map((r: any) => ({
      computedAt: r.computed_at,
      demand: r.demand_weight,
      timing: r.timing_weight,
      buildability: r.buildability_weight,
      virality: r.virality_weight,
      precision: r.precision_score,
      sampleSize: r.sample_size,
    }));

    const pred = predResult.rows[0] as any;
    const total = Number(pred?.total ?? 0);
    const validated = Number(pred?.validated ?? 0);
    const expCount = Number((expResult.rows[0] as any)?.count ?? 0);

    const record: ScoringHealthRecord = {
      currentWeights: {
        profileId,
        ...weights,
      },
      optimizationHistory: history,
      predictionTrackRecord: {
        total,
        validated,
        accuracy: total > 0 ? Math.round((validated / total) * 1000) / 10 : null,
      },
      experienceLibrarySize: expCount,
    };

    return record;
  });
};
```

**Step 4: Run tests**

```bash
cd apps/api && pnpm exec vitest run tests/scoring_health.test.ts
```

**Step 5: Commit**

```bash
git add packages/contracts/src/api.ts apps/api/src/routes/scoring_health.ts apps/api/tests/scoring_health.test.ts
git commit -m "feat: add scoring health contract type and API route"
```

---

### Task 11: Register scoring health route in server

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/server.ts` (ServerDeps type)

**Step 1: Add import and registration**

Import at top:
```typescript
import { registerScoringHealthRoute } from './routes/scoring_health';
import { getActiveWeights } from './runtime/active_weights';
```

After the opportunity map registration (around line 164), add:
```typescript
if (resolvedDeps.pool) {
  registerScoringHealthRoute(app, {
    pool: resolvedDeps.pool,
    getActiveWeights: (profileId) => getActiveWeights(resolvedDeps.pool!, profileId),
  });
}
```

**Step 2: Run all tests**

```bash
cd apps/api && CI=1 pnpm test
```

**Step 3: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "feat: register scoring health route in server"
```

---

### Task 12: ScoringHealth frontend component

**Files:**
- Create: `apps/web/src/components/ScoringHealth.tsx`

**Step 1: Create the component**

```typescript
import React, { useEffect, useState } from 'react';
import type { ScoringHealthRecord } from '@idea/contracts/src/api';
import { buildApiUrl } from '../api';

export const ScoringHealth: React.FC<{ apiUrl: string }> = ({ apiUrl }) => {
  const [data, setData] = useState<ScoringHealthRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiUrl}/v1/scoring-health`)
      .then(res => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<ScoringHealthRecord>;
      })
      .then(d => { if (!cancelled) setData(d); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [apiUrl]);

  if (error) return <div className="scoring-error">Failed to load scoring health: {error}</div>;
  if (!data) return <div className="scoring-loading">Loading scoring health...</div>;

  const w = data.currentWeights;
  const tr = data.predictionTrackRecord;

  return (
    <div className="scoring-container">
      <div className="scoring-grid">
        <section className="scoring-card">
          <h4>Current Weights <span className="scoring-badge">{w.source}</span></h4>
          <table className="scoring-weights-table">
            <tbody>
              <tr><td>Demand</td><td>{(w.demand * 100).toFixed(0)}%</td></tr>
              <tr><td>Timing</td><td>{(w.timing * 100).toFixed(0)}%</td></tr>
              <tr><td>Buildability</td><td>{(w.buildability * 100).toFixed(0)}%</td></tr>
              <tr><td>Virality</td><td>{(w.virality * 100).toFixed(0)}%</td></tr>
            </tbody>
          </table>
        </section>

        <section className="scoring-card">
          <h4>Prediction Track Record</h4>
          <div className="scoring-stat-row">
            <span className="scoring-stat-label">Total predictions</span>
            <span className="scoring-stat-value">{tr.total}</span>
          </div>
          <div className="scoring-stat-row">
            <span className="scoring-stat-label">Validated</span>
            <span className="scoring-stat-value">{tr.validated}</span>
          </div>
          <div className="scoring-stat-row">
            <span className="scoring-stat-label">Accuracy</span>
            <span className="scoring-stat-value">{tr.accuracy !== null ? `${tr.accuracy}%` : 'N/A'}</span>
          </div>
        </section>

        <section className="scoring-card">
          <h4>Experience Library</h4>
          <div className="scoring-stat-row">
            <span className="scoring-stat-label">Stored trajectories</span>
            <span className="scoring-stat-value">{data.experienceLibrarySize}</span>
          </div>
        </section>
      </div>

      {data.optimizationHistory.length > 0 && (
        <section className="scoring-card scoring-history">
          <h4>Optimization History</h4>
          <table className="scoring-history-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>D</th>
                <th>T</th>
                <th>B</th>
                <th>V</th>
                <th>Precision</th>
                <th>Samples</th>
              </tr>
            </thead>
            <tbody>
              {data.optimizationHistory.map((h, i) => (
                <tr key={i}>
                  <td>{new Date(h.computedAt).toLocaleDateString()}</td>
                  <td>{(h.demand * 100).toFixed(0)}%</td>
                  <td>{(h.timing * 100).toFixed(0)}%</td>
                  <td>{(h.buildability * 100).toFixed(0)}%</td>
                  <td>{(h.virality * 100).toFixed(0)}%</td>
                  <td>{h.precision !== null ? `${(h.precision * 100).toFixed(1)}%` : '-'}</td>
                  <td>{h.sampleSize ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add apps/web/src/components/ScoringHealth.tsx
git commit -m "feat: add ScoringHealth drawer component"
```

---

### Task 13: Wire ScoringHealth drawer tab into App.tsx

**Files:**
- Modify: `apps/web/src/App.tsx`

**Step 1: Add import**

```typescript
import { ScoringHealth } from './components/ScoringHealth';
```

**Step 2: Add drawer state**

After `logDrawerOpen` state (around line 104):
```typescript
const [scoringHealthOpen, setScoringHealthOpen] = useState(false);
```

**Step 3: Add drawer section**

After the Opportunity Map drawer section (around line 649), before the Log drawer:

```tsx
{/* Scoring Health drawer */}
<section className={`omap-drawer ${scoringHealthOpen ? 'open' : ''}`}>
  <button
    type="button"
    className="omap-drawer-toggle"
    onClick={() => setScoringHealthOpen(v => !v)}
  >
    <span className="omap-drawer-title">Scoring Health</span>
    <span className="omap-drawer-chevron">{scoringHealthOpen ? '\u25BC' : '\u25B2'}</span>
  </button>
  {scoringHealthOpen && (
    <div className="omap-drawer-scroll">
      <ScoringHealth apiUrl={API_BASE} />
    </div>
  )}
</section>
```

**Step 4: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat: add Scoring Health drawer tab to App"
```

---

### Task 14: Scoring Health CSS

**Files:**
- Modify: `apps/web/src/styles.css`

**Step 1: Add styles**

```css
/* --- Scoring Health --- */
.scoring-container { padding: 1rem; }
.scoring-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
.scoring-card {
  background: var(--surface-2);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  padding: 1rem;
}
.scoring-card h4 {
  font-size: 0.85rem;
  color: var(--text-primary);
  margin: 0 0 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.scoring-badge {
  font-size: 0.65rem;
  text-transform: uppercase;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  background: var(--glass-border);
  color: var(--muted);
}
.scoring-weights-table { width: 100%; }
.scoring-weights-table td {
  padding: 0.25rem 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
}
.scoring-weights-table td:last-child { text-align: right; font-weight: 500; color: var(--text-primary); }
.scoring-stat-row {
  display: flex;
  justify-content: space-between;
  padding: 0.25rem 0;
  font-size: 0.8rem;
}
.scoring-stat-label { color: var(--muted); }
.scoring-stat-value { color: var(--text-primary); font-weight: 500; }
.scoring-history { grid-column: 1 / -1; }
.scoring-history-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
.scoring-history-table th {
  text-align: left;
  padding: 0.3rem 0.5rem;
  border-bottom: 1px solid var(--glass-border);
  color: var(--muted);
  font-weight: 500;
}
.scoring-history-table td {
  padding: 0.3rem 0.5rem;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--glass-border);
}
.scoring-loading, .scoring-error { padding: 2rem; text-align: center; color: var(--muted); }
```

**Step 2: Run all tests**

```bash
CI=1 pnpm test
```

**Step 3: Commit**

```bash
git add apps/web/src/styles.css
git commit -m "feat: add Scoring Health CSS"
```

---

## Slice 3: Knowledge Graph + Connections

### Task 15: Composite index migration

**Files:**
- Create: `apps/api/db/migrations/0025_debates_composite_index.sql`

**Step 1: Create migration**

```sql
-- 0025_debates_composite_index.sql
-- Add composite index for efficient thesis debate lookups ordered by time

CREATE INDEX IF NOT EXISTS idx_thesis_debates_key_created
  ON thesis_debates(thesis_key, created_at DESC);
```

**Step 2: Commit**

```bash
git add apps/api/db/migrations/0025_debates_composite_index.sql
git commit -m "feat: add composite index on thesis_debates(key, created_at)"
```

---

### Task 16: ENTITY_EXTRACT_BATCH_SIZE env var

**Files:**
- Modify: `apps/api/src/config/env.ts`

**Step 1: Add to RuntimeEnv type**

Add after `categoryMinPhraseCount`:
```typescript
entityExtractBatchSize: number;
```

**Step 2: Add parsing**

Add after the `categoryMinPhraseCount` line in `loadRuntimeEnv`:
```typescript
entityExtractBatchSize: parseNumber(env.ENTITY_EXTRACT_BATCH_SIZE, 10),
```

**Step 3: Commit**

```bash
git add apps/api/src/config/env.ts
git commit -m "feat: add ENTITY_EXTRACT_BATCH_SIZE env var"
```

---

### Task 17: Entities API route

**Files:**
- Modify: `packages/contracts/src/api.ts`
- Create: `apps/api/src/routes/entities.ts`
- Create: `apps/api/tests/entities.test.ts`

**Step 1: Add contract types**

Add to `packages/contracts/src/api.ts`:

```typescript
export type EntityRecord = {
  id: number;
  entityType: string;
  name: string;
  description: string | null;
  mentionCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  relations: {
    relationType: string;
    targetName: string;
    targetType: string;
    confidence: number;
  }[];
};

export type EntityInsights = {
  unaddressedPains: { name: string; mentionCount: number; description: string | null }[];
  emergingTech: { name: string; mentionCount: number; description: string | null }[];
  totalEntities: number;
  totalRelations: number;
};
```

**Step 2: Write test**

```typescript
// apps/api/tests/entities.test.ts
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerEntitiesRoute } from '../src/routes/entities';

describe('entities routes', () => {
  it('GET /v1/entities returns paginated entities', async () => {
    const app = Fastify();
    const mockPool = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{ id: 1, entity_type: 'pain_point', name: 'slow deploys', description: null, mention_count: 5, first_seen_at: '2026-01-01', last_seen_at: '2026-03-01' }]
        })
        .mockResolvedValueOnce({ rows: [] }) // relations
    };
    registerEntitiesRoute(app, { pool: mockPool as any, entityStore: null as any });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/v1/entities' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('slow deploys');
  });

  it('GET /v1/entities/insights returns insights', async () => {
    const app = Fastify();
    const mockEntityStore = {
      findUnaddressedPains: vi.fn().mockResolvedValue([]),
      findEmergingTech: vi.fn().mockResolvedValue([]),
    };
    const mockPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ count: '10' }] }) // entity count
        .mockResolvedValueOnce({ rows: [{ count: '5' }] }) // relation count
    };
    registerEntitiesRoute(app, { pool: mockPool as any, entityStore: mockEntityStore as any });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/v1/entities/insights' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalEntities).toBe(10);
  });
});
```

**Step 3: Write route implementation**

```typescript
// apps/api/src/routes/entities.ts
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { EntityStore } from '../runtime/entity_store';

export type EntitiesRouteDeps = {
  pool: Pool;
  entityStore: Pick<EntityStore, 'findUnaddressedPains' | 'findEmergingTech'>;
};

export const registerEntitiesRoute = (
  app: FastifyInstance,
  deps: EntitiesRouteDeps
): void => {
  app.get('/v1/entities', async (request) => {
    const query = request.query as { type?: string; limit?: string };
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));

    let sql = `SELECT id, entity_type, name, description, mention_count, first_seen_at, last_seen_at
               FROM entities`;
    const params: any[] = [];
    if (query.type) {
      params.push(query.type);
      sql += ` WHERE entity_type = $${params.length}`;
    }
    sql += ` ORDER BY mention_count DESC`;
    params.push(limit);
    sql += ` LIMIT $${params.length}`;

    const { rows: entities } = await deps.pool.query(sql, params);

    if (entities.length === 0) return [];

    const entityIds = entities.map((e: any) => e.id);
    const { rows: relations } = await deps.pool.query(
      `SELECT r.source_entity_id, r.relation_type, r.confidence,
              e.name AS target_name, e.entity_type AS target_type
       FROM entity_relations r
       JOIN entities e ON e.id = r.target_entity_id
       WHERE r.source_entity_id = ANY($1)`,
      [entityIds]
    );

    const relMap = new Map<number, any[]>();
    for (const r of relations as any[]) {
      const list = relMap.get(r.source_entity_id) ?? [];
      list.push({
        relationType: r.relation_type,
        targetName: r.target_name,
        targetType: r.target_type,
        confidence: r.confidence,
      });
      relMap.set(r.source_entity_id, list);
    }

    return entities.map((e: any) => ({
      id: e.id,
      entityType: e.entity_type,
      name: e.name,
      description: e.description,
      mentionCount: e.mention_count,
      firstSeenAt: e.first_seen_at,
      lastSeenAt: e.last_seen_at,
      relations: relMap.get(e.id) ?? [],
    }));
  });

  app.get('/v1/entities/insights', async () => {
    const [pains, tech, entityCount, relCount] = await Promise.all([
      deps.entityStore.findUnaddressedPains(2),
      deps.entityStore.findEmergingTech(2),
      deps.pool.query(`SELECT COUNT(*)::int AS count FROM entities`),
      deps.pool.query(`SELECT COUNT(*)::int AS count FROM entity_relations`),
    ]);

    return {
      unaddressedPains: pains.map(p => ({ name: p.name, mentionCount: p.mention_count, description: p.description ?? null })),
      emergingTech: tech.map(t => ({ name: t.name, mentionCount: t.mention_count, description: t.description ?? null })),
      totalEntities: Number((entityCount.rows[0] as any)?.count ?? 0),
      totalRelations: Number((relCount.rows[0] as any)?.count ?? 0),
    };
  });
};
```

**Step 4: Run tests**

```bash
cd apps/api && pnpm exec vitest run tests/entities.test.ts
```

**Step 5: Commit**

```bash
git add packages/contracts/src/api.ts apps/api/src/routes/entities.ts apps/api/tests/entities.test.ts
git commit -m "feat: add entities API routes with insights endpoint"
```

---

### Task 18: Register entities route and wire entity extraction in main.ts

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/main.ts`

**Step 1: Register route in server.ts**

Import:
```typescript
import { registerEntitiesRoute } from './routes/entities';
```

Add `entityStore` to `ServerDeps` type:
```typescript
entityStore?: import('../runtime/entity_store').EntityStore | null;
```

After opportunity map registration:
```typescript
if (resolvedDeps.pool && resolvedDeps.entityStore) {
  registerEntitiesRoute(app, {
    pool: resolvedDeps.pool,
    entityStore: resolvedDeps.entityStore,
  });
}
```

**Step 2: Pass entityStore to server deps in main.ts**

In `serverDeps` object (around line 249), add:
```typescript
entityStore: entityStore ?? null,
```

**Step 3: Run all tests**

```bash
cd apps/api && CI=1 pnpm test
```

**Step 4: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/main.ts
git commit -m "feat: register entities route and pass entityStore to server"
```

---

### Task 19: Wire entity extraction into post-scrape pipeline

**Files:**
- Modify: `apps/api/src/main.ts`

This is the critical wiring step. Entity extraction runs after signal scoring, on the top N signals per refresh batch.

**Step 1: Add entity extraction after refresh**

Find the connector refresh handler in main.ts (the `readModel.refresh` call). After the refresh completes, add entity extraction.

In the `triggerRefresh` callback in `serverDeps` (around line 255), change:
```typescript
triggerRefresh: async (cadence) => {
  stateHub.pushRefreshMeta();
  await readModel.refresh(cadence);

  // Entity extraction on top signals from this batch
  if (entityStore && modelRouter) {
    const runtimeEnv = loadRuntimeEnv(process.env);
    const topSignals = await memoryStore?.listAllSignals(runtimeEnv.entityExtractBatchSize) ?? [];
    const { extractEntities } = await import('./jobs/entity_extractor');
    for (const signal of topSignals) {
      try {
        await extractEntities({
          signalText: signal.canonical_text,
          signalId: signal.signal_id,
          route: (task, prompt) => modelRouter!.route(task, prompt),
          entityStore,
        });
      } catch {
        // Non-critical — log and continue
      }
    }
  }

  void stateHub.broadcastAll();
},
```

Note: Entity extraction uses the model router's `route` method, which sends `entity_extraction` tasks to Ollama cheap tier. If `MODEL_ROUTING_ENABLED=false`, entity extraction doesn't run (both `entityStore` and `modelRouter` must be non-null).

**Step 2: Commit**

```bash
git add apps/api/src/main.ts
git commit -m "feat: wire entity extraction into post-refresh pipeline via model router"
```

---

### Task 20: ConnectionsView frontend component

**Files:**
- Create: `apps/web/src/components/ConnectionsView.tsx`

**Step 1: Create component**

```typescript
import React, { useEffect, useState } from 'react';
import type { EntityInsights, EntityRecord } from '@idea/contracts/src/api';

type Props = { apiUrl: string };

export const ConnectionsView: React.FC<Props> = ({ apiUrl }) => {
  const [insights, setInsights] = useState<EntityInsights | null>(null);
  const [entities, setEntities] = useState<EntityRecord[]>([]);
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${apiUrl}/v1/entities/insights`).then(r => r.ok ? r.json() : Promise.reject(r.status)),
      fetch(`${apiUrl}/v1/entities?limit=50`).then(r => r.ok ? r.json() : Promise.reject(r.status)),
    ])
      .then(([ins, ents]) => {
        if (cancelled) return;
        setInsights(ins);
        setEntities(ents);
      })
      .catch(err => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [apiUrl]);

  if (error) return <div className="conn-error">Failed to load: {error}</div>;
  if (!insights) return <div className="conn-loading">Loading connections...</div>;

  const filteredEntities = typeFilter === 'all'
    ? entities
    : entities.filter(e => e.entityType === typeFilter);

  const entityTypes = ['all', 'pain_point', 'technology', 'market', 'competitor', 'trend'];

  return (
    <div className="conn-container">
      <div className="conn-stats">
        <span>{insights.totalEntities} entities</span>
        <span>{insights.totalRelations} relations</span>
      </div>

      {insights.unaddressedPains.length > 0 && (
        <section className="conn-section">
          <h4>Unaddressed Pain Points</h4>
          <p className="conn-hint">Pain points with no known product addressing them</p>
          <ul className="conn-insight-list">
            {insights.unaddressedPains.map((p, i) => (
              <li key={i} className="conn-insight-item pain">
                <span className="conn-insight-name">{p.name}</span>
                <span className="conn-insight-count">{p.mentionCount} mentions</span>
                {p.description && <span className="conn-insight-desc">{p.description}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {insights.emergingTech.length > 0 && (
        <section className="conn-section">
          <h4>Emerging Technologies</h4>
          <p className="conn-hint">Technologies not yet dominated by any competitor</p>
          <ul className="conn-insight-list">
            {insights.emergingTech.map((t, i) => (
              <li key={i} className="conn-insight-item tech">
                <span className="conn-insight-name">{t.name}</span>
                <span className="conn-insight-count">{t.mentionCount} mentions</span>
                {t.description && <span className="conn-insight-desc">{t.description}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="conn-section">
        <h4>All Entities</h4>
        <div className="conn-type-filters">
          {entityTypes.map(t => (
            <button
              key={t}
              type="button"
              className={`conn-type-btn ${typeFilter === t ? 'active' : ''}`}
              onClick={() => setTypeFilter(t)}
            >
              {t === 'all' ? 'All' : t.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        {filteredEntities.length === 0 ? (
          <p className="conn-empty">No entities yet. Enable MODEL_ROUTING_ENABLED=true and run a refresh.</p>
        ) : (
          <ul className="conn-entity-list">
            {filteredEntities.map(e => (
              <li key={e.id} className="conn-entity-item">
                <div
                  className="conn-entity-row"
                  onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={ev => { if (ev.key === 'Enter') setExpandedId(expandedId === e.id ? null : e.id); }}
                >
                  <span className={`conn-entity-type type-${e.entityType}`}>{e.entityType.replace(/_/g, ' ')}</span>
                  <span className="conn-entity-name">{e.name}</span>
                  <span className="conn-entity-mentions">{e.mentionCount}</span>
                  {e.relations.length > 0 && (
                    <span className="conn-entity-rel-count">{e.relations.length} rel</span>
                  )}
                </div>
                {expandedId === e.id && e.relations.length > 0 && (
                  <ul className="conn-relations">
                    {e.relations.map((r, i) => (
                      <li key={i} className="conn-relation">
                        <span className="conn-rel-type">{r.relationType.replace(/_/g, ' ')}</span>
                        <span className="conn-rel-target">{r.targetType}: {r.targetName}</span>
                        <span className="conn-rel-conf">{(r.confidence * 100).toFixed(0)}%</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add apps/web/src/components/ConnectionsView.tsx
git commit -m "feat: add ConnectionsView component for knowledge graph"
```

---

### Task 21: Wire Connections drawer in App.tsx and add CSS

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

**Step 1: Add import**

```typescript
import { ConnectionsView } from './components/ConnectionsView';
```

**Step 2: Add state**

After `scoringHealthOpen`:
```typescript
const [connectionsOpen, setConnectionsOpen] = useState(false);
```

**Step 3: Add drawer section**

After the Scoring Health drawer:
```tsx
{/* Connections drawer */}
<section className={`omap-drawer ${connectionsOpen ? 'open' : ''}`}>
  <button
    type="button"
    className="omap-drawer-toggle"
    onClick={() => setConnectionsOpen(v => !v)}
  >
    <span className="omap-drawer-title">Connections</span>
    <span className="omap-drawer-chevron">{connectionsOpen ? '\u25BC' : '\u25B2'}</span>
  </button>
  {connectionsOpen && (
    <div className="omap-drawer-scroll">
      <ConnectionsView apiUrl={API_BASE} />
    </div>
  )}
</section>
```

**Step 4: Add CSS to styles.css**

```css
/* --- Connections View --- */
.conn-container { padding: 1rem; }
.conn-stats {
  display: flex;
  gap: 1rem;
  font-size: 0.8rem;
  color: var(--muted);
  margin-bottom: 1rem;
}
.conn-section { margin-bottom: 1.5rem; }
.conn-section h4 { font-size: 0.9rem; color: var(--text-primary); margin: 0 0 0.25rem; }
.conn-hint { font-size: 0.75rem; color: var(--muted); margin: 0 0 0.5rem; }
.conn-insight-list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.conn-insight-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
  border: 1px solid var(--glass-border);
  font-size: 0.8rem;
}
.conn-insight-item.pain { border-left: 3px solid var(--error); }
.conn-insight-item.tech { border-left: 3px solid var(--accent); }
.conn-insight-name { font-weight: 500; color: var(--text-primary); }
.conn-insight-count { color: var(--muted); font-size: 0.75rem; }
.conn-insight-desc { color: var(--text-secondary); font-size: 0.75rem; flex: 1; }
.conn-type-filters { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-bottom: 0.75rem; }
.conn-type-btn {
  background: transparent;
  border: 1px solid var(--glass-border);
  color: var(--muted);
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  font-size: 0.75rem;
  cursor: pointer;
  text-transform: capitalize;
}
.conn-type-btn.active { color: var(--text-primary); background: var(--surface-2); border-color: var(--accent); }
.conn-entity-list { list-style: none; padding: 0; }
.conn-entity-item { border-bottom: 1px solid var(--glass-border); }
.conn-entity-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0;
  cursor: pointer;
  font-size: 0.8rem;
}
.conn-entity-type {
  font-size: 0.65rem;
  text-transform: uppercase;
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  background: var(--glass-border);
  color: var(--muted);
  white-space: nowrap;
}
.type-pain_point { color: var(--error); }
.type-technology { color: var(--accent); }
.type-market { color: var(--ok); }
.type-competitor { color: var(--warn); }
.type-trend { color: #a78bfa; }
.conn-entity-name { flex: 1; color: var(--text-primary); }
.conn-entity-mentions { color: var(--muted); font-size: 0.75rem; }
.conn-entity-rel-count { color: var(--accent); font-size: 0.7rem; }
.conn-relations { list-style: none; padding: 0 0 0.5rem 1.5rem; }
.conn-relation {
  display: flex;
  gap: 0.5rem;
  font-size: 0.75rem;
  padding: 0.2rem 0;
  color: var(--text-secondary);
}
.conn-rel-type { color: var(--muted); font-style: italic; }
.conn-rel-target { flex: 1; }
.conn-rel-conf { color: var(--muted); }
.conn-empty { font-size: 0.8rem; color: var(--muted); }
.conn-loading, .conn-error { padding: 2rem; text-align: center; color: var(--muted); }
```

**Step 5: Run all tests**

```bash
CI=1 pnpm test
```

**Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "feat: add Connections drawer tab with entity list and insights"
```

---

## Slice 4: Model Router Integration

### Task 22: Add counters to model router

**Files:**
- Modify: `packages/ai-runtime/src/router.ts`

**Step 1: Add counter fields to Router type and implementation**

Update the `Router` type:
```typescript
export type RouterStats = {
  ollamaCalls: number;
  ollamaSucceeded: number;
  ollamaFailed: number;
  cliCalls: number;
  cliSucceeded: number;
  cliFailed: number;
  fallbacks: number;
};

export type Router = {
  route: (task: string, prompt: string) => Promise<string>;
  getStats: () => RouterStats;
  resetStats: () => void;
};
```

Update `createRouter`:
```typescript
export const createRouter = (deps: RouterDeps): Router => {
  const stats: RouterStats = {
    ollamaCalls: 0, ollamaSucceeded: 0, ollamaFailed: 0,
    cliCalls: 0, cliSucceeded: 0, cliFailed: 0, fallbacks: 0,
  };

  return {
    route: async (task: string, prompt: string): Promise<string> => {
      const route = TASK_ROUTES[task];
      if (!route || route.tier === 'expensive') {
        stats.cliCalls++;
        try {
          const result = await deps.runCli({ prompt });
          stats.cliSucceeded++;
          return result.text;
        } catch (err) {
          stats.cliFailed++;
          throw err;
        }
      }

      const model = route.ollamaModel === 'cheap' ? deps.ollamaCheapModel : deps.ollamaMediumModel;
      stats.ollamaCalls++;

      try {
        const result = await deps.runOllama(prompt, {
          model,
          baseUrl: deps.ollamaBaseUrl,
          timeoutMs: deps.ollamaTimeoutMs,
        });
        stats.ollamaSucceeded++;
        return result;
      } catch (err) {
        stats.ollamaFailed++;
        if (route.fallbackToCli) {
          stats.fallbacks++;
          stats.cliCalls++;
          try {
            const result = await deps.runCli({ prompt });
            stats.cliSucceeded++;
            return result.text;
          } catch (cliErr) {
            stats.cliFailed++;
            throw cliErr;
          }
        }
        throw err;
      }
    },
    getStats: () => ({ ...stats }),
    resetStats: () => {
      stats.ollamaCalls = 0; stats.ollamaSucceeded = 0; stats.ollamaFailed = 0;
      stats.cliCalls = 0; stats.cliSucceeded = 0; stats.cliFailed = 0;
      stats.fallbacks = 0;
    },
  };
};
```

**Step 2: Commit**

```bash
git add packages/ai-runtime/src/router.ts
git commit -m "feat: add call counters to model router"
```

---

### Task 23: Add RouterStats to AiHealthRecord and route

**Files:**
- Modify: `packages/contracts/src/api.ts`
- Modify: `apps/api/src/routes/ai_health.ts`
- Modify: `apps/api/src/server.ts`

**Step 1: Add to contract type**

In `AiHealthRecord`, add:
```typescript
routerStats?: {
  ollamaCalls: number;
  ollamaSucceeded: number;
  cliCalls: number;
  cliSucceeded: number;
  fallbacks: number;
  routingEnabled: boolean;
};
```

**Step 2: Update ai_health route**

```typescript
// apps/api/src/routes/ai_health.ts
import type { AiHealthRecord } from '@idea/contracts/src/api';
import type { FastifyInstance } from 'fastify';
import type { RouterStats } from '@idea/ai-runtime/src/router';

export type { AiHealthRecord, AiProviderHealthRecord, AiProviderName, AiProviderStatus } from '@idea/contracts/src/api';

export type AiHealthDeps = {
  getAiHealth: () => Promise<AiHealthRecord>;
  getRouterStats?: () => { stats: RouterStats; enabled: boolean } | null;
};

export const registerAiHealthRoute = (
  app: FastifyInstance,
  deps: AiHealthDeps
): void => {
  app.get('/v1/ai-health', async () => {
    const health = await deps.getAiHealth();
    if (deps.getRouterStats) {
      const router = deps.getRouterStats();
      if (router) {
        health.routerStats = {
          ollamaCalls: router.stats.ollamaCalls,
          ollamaSucceeded: router.stats.ollamaSucceeded,
          cliCalls: router.stats.cliCalls,
          cliSucceeded: router.stats.cliSucceeded,
          fallbacks: router.stats.fallbacks,
          routingEnabled: router.enabled,
        };
      }
    }
    return health;
  });
};
```

**Step 3: Update server.ts to accept and pass getRouterStats**

Add to `ServerDeps`:
```typescript
getRouterStats?: () => { stats: import('@idea/ai-runtime/src/router').RouterStats; enabled: boolean } | null;
```

Update `registerAiHealthRoute` call:
```typescript
registerAiHealthRoute(app, {
  getAiHealth: resolvedDeps.getAiHealth,
  ...(resolvedDeps.getRouterStats ? { getRouterStats: resolvedDeps.getRouterStats } : {}),
});
```

**Step 4: Pass in main.ts**

In `serverDeps`, add:
```typescript
getRouterStats: () => modelRouter
  ? { stats: modelRouter.getStats(), enabled: startupEnv.modelRoutingEnabled }
  : null,
```

**Step 5: Run all tests**

```bash
CI=1 pnpm test
```

**Step 6: Commit**

```bash
git add packages/contracts/src/api.ts apps/api/src/routes/ai_health.ts apps/api/src/server.ts apps/api/src/main.ts
git commit -m "feat: expose model router stats in AI health endpoint"
```

---

### Task 24: Show router stats in Sidebar

**Files:**
- Modify: `apps/web/src/components/Sidebar.tsx`

**Step 1: Add router stats display**

In the AI Health section of the sidebar (look for where `providers` are rendered), add after the providers list:

```tsx
{aiHealth.routerStats && (
  <div className="sidebar-section">
    <h4 className="sidebar-section-title">Model Routing</h4>
    <div className="sidebar-stat-row">
      <span>Status</span>
      <span className={`dot ${aiHealth.routerStats.routingEnabled ? 'dot-ok' : 'dot-idle'}`}>
        {aiHealth.routerStats.routingEnabled ? 'Enabled' : 'Disabled'}
      </span>
    </div>
    <div className="sidebar-stat-row">
      <span>Ollama calls</span>
      <span>{aiHealth.routerStats.ollamaCalls} ({aiHealth.routerStats.ollamaSucceeded} ok)</span>
    </div>
    <div className="sidebar-stat-row">
      <span>CLI calls</span>
      <span>{aiHealth.routerStats.cliCalls} ({aiHealth.routerStats.cliSucceeded} ok)</span>
    </div>
    {aiHealth.routerStats.fallbacks > 0 && (
      <div className="sidebar-stat-row">
        <span>Fallbacks</span>
        <span>{aiHealth.routerStats.fallbacks}</span>
      </div>
    )}
  </div>
)}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/Sidebar.tsx
git commit -m "feat: show model router stats in sidebar AI Health section"
```

---

### Task 25: Apply migration and run full test suite

**Step 1: Apply migration**

```bash
psql "$DATABASE_URL" -f apps/api/db/migrations/0025_debates_composite_index.sql
```

**Step 2: Run all tests**

```bash
CI=1 pnpm test
```
Expected: All tests pass.

**Step 3: Commit (if any fixes were needed)**

Only if tests required fixes. Otherwise, this is verification only.

---

### Task 26: Final integration verification

**Step 1: Start API and web servers**

```bash
cd apps/api && pnpm dev &
cd apps/web && pnpm dev &
```

**Step 2: Verify each feature**

- [ ] Open thesis deep-dive modal → "Why this score?" tab shows weight breakdown
- [ ] Bottom drawer → "Scoring Health" shows current weights, empty optimization history
- [ ] Bottom drawer → "Connections" shows empty state (needs MODEL_ROUTING_ENABLED=true)
- [ ] Sidebar → AI Health → Model Routing section shows stats (if routing enabled)
- [ ] `curl localhost:3001/v1/theses/<key>/explain` returns JSON with weightBreakdown
- [ ] `curl localhost:3001/v1/scoring-health` returns JSON with currentWeights
- [ ] `curl localhost:3001/v1/entities` returns empty array (or entities if populated)
- [ ] `curl localhost:3001/v1/entities/insights` returns insights structure

**Step 3: Stop servers and final commit**

```bash
kill %1 %2  # stop background jobs
```
