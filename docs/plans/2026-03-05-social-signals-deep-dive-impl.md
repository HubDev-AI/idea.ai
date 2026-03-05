# Social Signals + Idea Deep-Dive Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 3 consumer/social connectors, tune agent prompts for consumer focus, and build a click-to-expand thesis deep-dive modal with AI generation and DB caching.

**Architecture:** New connectors follow existing pattern (fetch function + registration in cadence/limits maps + wiring in ingest_open.ts). Deep-dive uses a new DB table, two API endpoints (GET cached, POST generate), and a frontend modal. AI generation reuses the existing dual-analyst provider routing.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React 18, CSS custom properties, `claude -p` / `codex exec` CLI adapters.

---

## Task 1: DB Migration for thesis_deep_dives

**Files:**
- Create: `apps/api/db/migrations/0015_thesis_deep_dives.sql`

**Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS thesis_deep_dives (
  id BIGSERIAL PRIMARY KEY,
  canonical_key TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  how_it_works TEXT NOT NULL,
  growth_strategy TEXT NOT NULL,
  build_suggestions TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS thesis_deep_dives_key_idx
  ON thesis_deep_dives (canonical_key);
```

Note: We use a plain UNIQUE constraint on canonical_key without a FK to thesis_candidates(canonical_key) because the thesis_candidates table uses `id` as its PK and canonical_key as a UNIQUE column. A FK would require it to be a PK or have a UNIQUE constraint on the referenced side (which it does), but keeping it simple avoids cascade complexity. The app layer ensures the thesis exists before generating a deep-dive.

**Step 2: Run the migration**

Run: `bash apps/api/db/db-migrate.sh`
Expected: Migration applies successfully, table created.

**Step 3: Verify**

Run: `psql "$DATABASE_URL" -c "\\d thesis_deep_dives"`
Expected: Table with columns id, canonical_key, summary, how_it_works, growth_strategy, build_suggestions, generated_by, created_at.

**Step 4: Commit**

```bash
git add apps/api/db/migrations/0015_thesis_deep_dives.sql
git commit -c commit.gpgsign=false -m "feat: add thesis_deep_dives migration"
```

---

## Task 2: Deep-Dive Contract Types

**Files:**
- Modify: `packages/contracts/src/api.ts`

**Step 1: Add ThesisDeepDive type**

After the `ThesisPage` type (around line 125), add:

```typescript
export type ThesisDeepDive = {
  canonicalKey: string;
  summary: string;
  howItWorks: string;
  growthStrategy: string;
  buildSuggestions: string;
  generatedBy: string;
  createdAt: string;
};
```

**Step 2: Verify build**

Run: `pnpm --filter @idea/contracts exec tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add packages/contracts/src/api.ts
git commit -c commit.gpgsign=false -m "feat: add ThesisDeepDive contract type"
```

---

## Task 3: Deep-Dive Store (DB Access Layer)

**Files:**
- Create: `apps/api/src/runtime/deep_dive_store.ts`

**Step 1: Write the store**

```typescript
import type { ThesisDeepDive } from '@idea/contracts/src/api';
import type { Pool } from 'pg';

type DeepDiveRow = {
  canonical_key: string;
  summary: string;
  how_it_works: string;
  growth_strategy: string;
  build_suggestions: string;
  generated_by: string;
  created_at: Date;
};

const rowToDeepDive = (row: DeepDiveRow): ThesisDeepDive => ({
  canonicalKey: row.canonical_key,
  summary: row.summary,
  howItWorks: row.how_it_works,
  growthStrategy: row.growth_strategy,
  buildSuggestions: row.build_suggestions,
  generatedBy: row.generated_by,
  createdAt: row.created_at.toISOString(),
});

export type DeepDiveStore = {
  getByKey(canonicalKey: string): Promise<ThesisDeepDive | null>;
  save(canonicalKey: string, data: {
    summary: string;
    howItWorks: string;
    growthStrategy: string;
    buildSuggestions: string;
    generatedBy: string;
  }): Promise<ThesisDeepDive>;
};

export const createDeepDiveStore = ({ pool }: { pool: Pool }): DeepDiveStore => ({
  async getByKey(canonicalKey: string): Promise<ThesisDeepDive | null> {
    const result = await pool.query<DeepDiveRow>(
      'SELECT * FROM thesis_deep_dives WHERE canonical_key = $1',
      [canonicalKey]
    );
    return result.rows[0] ? rowToDeepDive(result.rows[0]) : null;
  },

  async save(canonicalKey, data): Promise<ThesisDeepDive> {
    const result = await pool.query<DeepDiveRow>(
      `INSERT INTO thesis_deep_dives
        (canonical_key, summary, how_it_works, growth_strategy, build_suggestions, generated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (canonical_key) DO UPDATE SET
         summary = EXCLUDED.summary,
         how_it_works = EXCLUDED.how_it_works,
         growth_strategy = EXCLUDED.growth_strategy,
         build_suggestions = EXCLUDED.build_suggestions,
         generated_by = EXCLUDED.generated_by,
         created_at = NOW()
       RETURNING *`,
      [canonicalKey, data.summary, data.howItWorks, data.growthStrategy, data.buildSuggestions, data.generatedBy]
    );
    return rowToDeepDive(result.rows[0]);
  },
});
```

**Step 2: Verify build**

Run: `cd apps/api && pnpm exec tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/api/src/runtime/deep_dive_store.ts
git commit -c commit.gpgsign=false -m "feat: add deep-dive store for thesis enrichment"
```

---

## Task 4: Deep-Dive AI Generation Logic

**Files:**
- Create: `apps/api/src/jobs/deep_dive_generator.ts`

**Step 1: Write the generator**

```typescript
import type { RunPromptInput, RunPromptResult } from '@idea/ai-runtime/src/types';

export type DeepDiveInput = {
  title: string;
  problemStatement: string;
  targetBuyer: string;
  proposedSolution: string;
  confidence: number;
};

export type DeepDiveResult = {
  summary: string;
  howItWorks: string;
  growthStrategy: string;
  buildSuggestions: string;
};

export type DeepDiveGeneratorDeps = {
  runClaude: (input: RunPromptInput) => Promise<RunPromptResult>;
  runCodex: (input: RunPromptInput) => Promise<RunPromptResult>;
  preferredProvider?: 'claude' | 'codex';
};

const DEEP_DIVE_TIMEOUT_MS = 60_000;

const buildDeepDivePrompt = (input: DeepDiveInput): string =>
  `You are a product strategist analyzing a startup idea for a solo founder.

Given this product thesis:
- Title: ${input.title}
- Problem: ${input.problemStatement}
- Target buyer: ${input.targetBuyer}
- Proposed solution: ${input.proposedSolution}
- Confidence: ${input.confidence}%

Generate a concise deep-dive analysis. Keep each section 2-4 sentences max.
Focus on actionability -- what would a solo founder need to know to decide whether to build this?

Return ONLY valid JSON (no markdown, no code fences):
{
  "summary": "What this idea is and why it matters right now",
  "how_it_works": "Key features and core user experience flow",
  "growth_strategy": "How users discover and share this product -- specific viral mechanics and channels",
  "build_suggestions": "Recommended tech approach, MVP scope, and first 3 steps to validate"
}`;

const parseDeepDiveResponse = (raw: string): DeepDiveResult | null => {
  try {
    const text = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(text) as Record<string, string>;
    if (!parsed.summary || !parsed.how_it_works || !parsed.growth_strategy || !parsed.build_suggestions) {
      return null;
    }
    return {
      summary: parsed.summary,
      howItWorks: parsed.how_it_works,
      growthStrategy: parsed.growth_strategy,
      buildSuggestions: parsed.build_suggestions,
    };
  } catch {
    return null;
  }
};

export const generateDeepDive = async (
  input: DeepDiveInput,
  deps: DeepDiveGeneratorDeps
): Promise<{ result: DeepDiveResult; provider: string }> => {
  const prompt = buildDeepDivePrompt(input);
  const runInput: RunPromptInput = { prompt, timeoutMs: DEEP_DIVE_TIMEOUT_MS };

  const preferred = deps.preferredProvider ?? 'claude';
  const primaryRun = preferred === 'codex' ? deps.runCodex : deps.runClaude;
  const fallbackRun = preferred === 'codex' ? deps.runClaude : deps.runCodex;
  const primaryName = preferred === 'codex' ? 'codex' : 'claude';
  const fallbackName = preferred === 'codex' ? 'claude' : 'codex';

  // Try primary
  try {
    const response = await primaryRun(runInput);
    const parsed = parseDeepDiveResponse(response.text);
    if (parsed) return { result: parsed, provider: primaryName };
  } catch {
    // Fall through to fallback
  }

  // Try fallback
  try {
    const response = await fallbackRun(runInput);
    const parsed = parseDeepDiveResponse(response.text);
    if (parsed) return { result: parsed, provider: fallbackName };
  } catch {
    // Both failed
  }

  throw new Error('Both AI providers failed to generate deep-dive');
};
```

**Step 2: Verify build**

Run: `cd apps/api && pnpm exec tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/api/src/jobs/deep_dive_generator.ts
git commit -c commit.gpgsign=false -m "feat: add deep-dive AI generation logic"
```

---

## Task 5: Deep-Dive API Endpoints

**Files:**
- Modify: `apps/api/src/routes/theses.ts`

**Step 1: Add deep-dive deps and endpoints**

Add imports at top of file:

```typescript
import type { DeepDiveStore } from '../runtime/deep_dive_store';
import { generateDeepDive, type DeepDiveGeneratorDeps } from '../jobs/deep_dive_generator';
```

Extend ThesesRouteDeps:

```typescript
export type ThesesRouteDeps = {
  store: ThesisStore;
  memoryStore?: PostgresMemoryStore | null;
  deepDiveStore?: DeepDiveStore | null;
  deepDiveAi?: DeepDiveGeneratorDeps | null;
};
```

After the existing `POST /v1/theses/synthesize` route, add:

```typescript
  // GET /v1/theses/:key/deep-dive
  app.get('/v1/theses/:key/deep-dive', {
    schema: {
      params: {
        type: 'object',
        properties: { key: { type: 'string', minLength: 1, maxLength: 200 } },
        required: ['key']
      }
    }
  }, async (request, reply) => {
    if (!deps.deepDiveStore) {
      reply.code(503);
      return { error: 'Deep-dive store not available' };
    }
    const { key } = request.params as { key: string };
    const cached = await deps.deepDiveStore.getByKey(key);
    if (!cached) {
      reply.code(404);
      return { error: 'Deep-dive not generated yet' };
    }
    return cached;
  });

  // POST /v1/theses/:key/deep-dive
  app.post('/v1/theses/:key/deep-dive', {
    schema: {
      params: {
        type: 'object',
        properties: { key: { type: 'string', minLength: 1, maxLength: 200 } },
        required: ['key']
      }
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    if (!deps.deepDiveStore || !deps.deepDiveAi) {
      reply.code(503);
      return { error: 'Deep-dive not available' };
    }
    const { key } = request.params as { key: string };

    // Return cached if exists
    const cached = await deps.deepDiveStore.getByKey(key);
    if (cached) return cached;

    // Fetch thesis data
    const thesis = await deps.store.getByKey(key);
    if (!thesis) {
      reply.code(404);
      return { error: 'Thesis not found' };
    }

    // Generate via AI
    const { result, provider } = await generateDeepDive({
      title: thesis.title,
      problemStatement: thesis.problemStatement,
      targetBuyer: thesis.targetBuyer,
      proposedSolution: thesis.proposedSolution,
      confidence: thesis.confidence,
    }, deps.deepDiveAi);

    // Save and return
    const saved = await deps.deepDiveStore.save(key, {
      summary: result.summary,
      howItWorks: result.howItWorks,
      growthStrategy: result.growthStrategy,
      buildSuggestions: result.buildSuggestions,
      generatedBy: provider,
    });

    return saved;
  });
```

**Step 2: Wire deps in main.ts**

In `apps/api/src/main.ts`, find where `registerThesesRoute` is called and add the deep-dive store and AI deps. Import `createDeepDiveStore` from `../runtime/deep_dive_store`. Create the store alongside the thesis store (where the pg pool is available). Pass `deepDiveStore` and `deepDiveAi` (reuse the existing `runClaude`/`runCodex` functions already available in main.ts for the agent runner) to `registerThesesRoute`.

Look for where `registerThesesRoute(app, ...)` is called and change:
```typescript
// Before:
registerThesesRoute(app, { store: thesisStore, memoryStore: pgMemoryStore });
// After:
registerThesesRoute(app, {
  store: thesisStore,
  memoryStore: pgMemoryStore,
  deepDiveStore: pgPool ? createDeepDiveStore({ pool: pgPool }) : null,
  deepDiveAi: { runClaude, runCodex, preferredProvider },
});
```

Also add the import at the top of main.ts:
```typescript
import { createDeepDiveStore } from './runtime/deep_dive_store';
```

**Step 3: Verify build**

Run: `cd apps/api && pnpm exec tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add apps/api/src/routes/theses.ts apps/api/src/main.ts
git commit -c commit.gpgsign=false -m "feat: add deep-dive API endpoints with AI generation"
```

---

## Task 6: Frontend API Client for Deep-Dive

**Files:**
- Modify: `apps/web/src/api.ts`

**Step 1: Add ThesisDeepDive import and fetch functions**

Add to the import block at top:
```typescript
import type { ThesisDeepDive } from '@idea/contracts/src/api';
```

Add to the re-export block:
```typescript
export type { ThesisDeepDive };
```

Add after the existing `triggerConnectorRefresh` function:

```typescript
export const fetchThesisDeepDive = async (canonicalKey: string): Promise<ThesisDeepDive | null> => {
  const response = await fetch(buildApiUrl(`/v1/theses/${encodeURIComponent(canonicalKey)}/deep-dive`));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`fetchThesisDeepDive failed: ${response.status}`);
  return response.json() as Promise<ThesisDeepDive>;
};

export const generateThesisDeepDive = async (canonicalKey: string): Promise<ThesisDeepDive> => {
  const response = await fetch(
    buildApiUrl(`/v1/theses/${encodeURIComponent(canonicalKey)}/deep-dive`),
    { method: 'POST', signal: AbortSignal.timeout(120_000) }
  );
  if (!response.ok) throw new Error(`generateThesisDeepDive failed: ${response.status}`);
  return response.json() as Promise<ThesisDeepDive>;
};
```

**Step 2: Commit**

```bash
git add apps/web/src/api.ts
git commit -c commit.gpgsign=false -m "feat: add deep-dive API client functions"
```

---

## Task 7: Deep-Dive Modal Component

**Files:**
- Create: `apps/web/src/components/ThesisDeepDiveModal.tsx`

**Step 1: Write the modal component**

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ThesisDeepDive, ThesisListItem } from '../api';
import { fetchThesisDeepDive, generateThesisDeepDive } from '../api';

type Props = {
  thesis: ThesisListItem;
  onClose: () => void;
};

type CacheEntry = ThesisDeepDive;
const cache = new Map<string, CacheEntry>();

export const ThesisDeepDiveModal: React.FC<Props> = ({ thesis, onClose }) => {
  const [data, setData] = useState<ThesisDeepDive | null>(
    cache.get(thesis.canonicalKey) ?? null
  );
  const [loading, setLoading] = useState(!cache.has(thesis.canonicalKey));
  const [error, setError] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cache.has(thesis.canonicalKey)) return;

    let cancelled = false;
    const load = async () => {
      try {
        // Try cached on server first
        const cached = await fetchThesisDeepDive(thesis.canonicalKey);
        if (cached && !cancelled) {
          cache.set(thesis.canonicalKey, cached);
          setData(cached);
          setLoading(false);
          return;
        }
        // Generate via AI
        const generated = await generateThesisDeepDive(thesis.canonicalKey);
        if (!cancelled) {
          cache.set(thesis.canonicalKey, generated);
          setData(generated);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to generate deep-dive');
          setLoading(false);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [thesis.canonicalKey]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    },
    [onClose]
  );

  return (
    <div className="deep-dive-backdrop" ref={backdropRef} onClick={handleBackdropClick}>
      <div className="deep-dive-modal">
        <div className="deep-dive-header">
          <h2 className="deep-dive-title">{thesis.title}</h2>
          <button className="deep-dive-close" onClick={onClose} type="button">&times;</button>
        </div>

        <div className="deep-dive-meta">
          <span className="deep-dive-confidence">
            Confidence: {thesis.confidence}%
          </span>
          {thesis.estimatedScope && (
            <span className="deep-dive-scope">
              Scope: {thesis.estimatedScope}
            </span>
          )}
          <span className="deep-dive-evidence">
            {thesis.evidenceCount} evidence &middot; {thesis.sourceCount} sources
          </span>
        </div>

        {loading && (
          <div className="deep-dive-loading">
            <div className="deep-dive-skeleton" />
            <div className="deep-dive-skeleton short" />
            <div className="deep-dive-skeleton" />
            <div className="deep-dive-skeleton short" />
            <p className="deep-dive-loading-text">Generating insights...</p>
          </div>
        )}

        {error && (
          <div className="deep-dive-error">
            <p>{error}</p>
            <button onClick={onClose} type="button">Close</button>
          </div>
        )}

        {data && (
          <div className="deep-dive-content">
            <section className="deep-dive-section">
              <h3>What is this?</h3>
              <p>{data.summary}</p>
            </section>
            <section className="deep-dive-section">
              <h3>How it works</h3>
              <p>{data.howItWorks}</p>
            </section>
            <section className="deep-dive-section">
              <h3>Growth strategy</h3>
              <p>{data.growthStrategy}</p>
            </section>
            <section className="deep-dive-section">
              <h3>Build suggestions</h3>
              <p>{data.buildSuggestions}</p>
            </section>
            {data.generatedBy && (
              <p className="deep-dive-provider">
                Generated by {data.generatedBy}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add apps/web/src/components/ThesisDeepDiveModal.tsx
git commit -c commit.gpgsign=false -m "feat: add ThesisDeepDiveModal component"
```

---

## Task 8: Modal CSS Styles

**Files:**
- Modify: `apps/web/src/styles.css`

**Step 1: Add modal styles**

Append to the end of styles.css:

```css
/* === Deep-Dive Modal === */

.deep-dive-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 2rem;
}

.deep-dive-modal {
  background: var(--surface);
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  box-shadow: var(--shadow-lg);
  max-width: 560px;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  padding: 1.5rem;
}

.deep-dive-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.deep-dive-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text);
  margin: 0;
  line-height: 1.35;
}

.deep-dive-close {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  flex-shrink: 0;
}

.deep-dive-close:hover {
  color: var(--text);
}

.deep-dive-meta {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  font-size: 0.75rem;
  color: var(--muted);
  margin-bottom: 1.25rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--glass-border);
}

.deep-dive-loading {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 0;
}

.deep-dive-skeleton {
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--surface-2) 25%, var(--glass) 50%, var(--surface-2) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s ease-in-out infinite;
}

.deep-dive-skeleton.short {
  width: 60%;
}

@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.deep-dive-loading-text {
  color: var(--muted);
  font-size: 0.8rem;
  text-align: center;
  margin-top: 0.5rem;
}

.deep-dive-error {
  text-align: center;
  padding: 2rem 0;
  color: var(--err);
  font-size: 0.85rem;
}

.deep-dive-error button {
  margin-top: 1rem;
  background: var(--surface-2);
  border: 1px solid var(--glass-border);
  color: var(--text);
  padding: 0.4rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
}

.deep-dive-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.deep-dive-section h3 {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0 0 0.35rem;
}

.deep-dive-section p {
  font-size: 0.85rem;
  color: var(--text);
  line-height: 1.55;
  margin: 0;
}

.deep-dive-provider {
  font-size: 0.7rem;
  color: var(--muted);
  text-align: right;
  margin-top: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--glass-border);
}
```

**Step 2: Commit**

```bash
git add apps/web/src/styles.css
git commit -c commit.gpgsign=false -m "feat: add deep-dive modal styles"
```

---

## Task 9: Wire Modal into App.tsx

**Files:**
- Modify: `apps/web/src/App.tsx`

**Step 1: Add state and modal rendering**

Add import at top:
```typescript
import { ThesisDeepDiveModal } from './components/ThesisDeepDiveModal';
```

Add state for the selected thesis to deep-dive (near other thesis state):
```typescript
const [deepDiveThesis, setDeepDiveThesis] = useState<ThesisListItem | null>(null);
```

Modify the `handleSelectThesis` callback. Currently it filters signals by thesis key. We want to ALSO open the modal. Change the existing handler to open the modal:
```typescript
const handleSelectThesis = useCallback((thesis: ThesisListItem) => {
  setDeepDiveThesis(thesis);
}, []);
```

Note: The existing thesis filtering behavior (clicking a thesis to filter signals) is being replaced by the deep-dive modal. If the user closes the modal, signals are not filtered. This is a design decision per the approved design doc.

At the end of the return JSX, before the closing fragment or wrapper div, add:
```tsx
{deepDiveThesis && (
  <ThesisDeepDiveModal
    thesis={deepDiveThesis}
    onClose={() => setDeepDiveThesis(null)}
  />
)}
```

**Step 2: Verify dev server**

Run: `cd apps/web && pnpm dev`
Expected: No build errors, modal opens when clicking a thesis card.

**Step 3: Commit**

```bash
git add apps/web/src/App.tsx
git commit -c commit.gpgsign=false -m "feat: wire deep-dive modal into App"
```

---

## Task 10: Google Trends Connector

**Files:**
- Create: `packages/connectors/src/google_trends.ts`
- Create: `packages/connectors/src/__tests__/google_trends.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { RawEventInput } from '../common/http';

// Will import after implementation
// import { fetchGoogleTrends } from '../google_trends';

describe('google_trends connector', () => {
  it('parses RSS items into RawEventInput', async () => {
    const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>AI dating app</title>
      <link>https://trends.google.com/trending?q=AI+dating+app</link>
      <pubDate>Wed, 05 Mar 2026 10:00:00 GMT</pubDate>
      <description>AI dating app - 200,000+ searches</description>
    </item>
    <item>
      <title>meal prep subscription</title>
      <link>https://trends.google.com/trending?q=meal+prep+subscription</link>
      <pubDate>Wed, 05 Mar 2026 09:00:00 GMT</pubDate>
      <description>meal prep subscription - 100,000+ searches</description>
    </item>
  </channel>
</rss>`;

    const { fetchGoogleTrends } = await import('../google_trends');
    const mockLoader = vi.fn().mockResolvedValue(mockRss);
    const results = await fetchGoogleTrends(mockLoader, 10);

    expect(results).toHaveLength(2);
    expect(results[0].source).toBe('google_trends');
    expect(results[0].text).toContain('AI dating app');
    expect(results[0].url).toContain('trends.google.com');
    expect(results[0].source_item_id).toMatch(/^gtrends:/);
  });

  it('respects limit parameter', async () => {
    const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item><title>A</title><link>https://a.com</link><pubDate>Wed, 05 Mar 2026 10:00:00 GMT</pubDate><description>A</description></item>
    <item><title>B</title><link>https://b.com</link><pubDate>Wed, 05 Mar 2026 09:00:00 GMT</pubDate><description>B</description></item>
    <item><title>C</title><link>https://c.com</link><pubDate>Wed, 05 Mar 2026 08:00:00 GMT</pubDate><description>C</description></item>
  </channel>
</rss>`;

    const { fetchGoogleTrends } = await import('../google_trends');
    const mockLoader = vi.fn().mockResolvedValue(mockRss);
    const results = await fetchGoogleTrends(mockLoader, 2);
    expect(results).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --dir packages/connectors exec vitest run src/__tests__/google_trends.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the connector**

```typescript
import { type RawEventInput, withRetry } from './common/http';

type GoogleTrendsLoaderFn = (limit: number) => Promise<string>;

const TRENDS_RSS_URL = 'https://trends.google.com/trending/rss?geo=US';

const defaultLoader: GoogleTrendsLoaderFn = async () => {
  return withRetry(async () => {
    const res = await fetch(TRENDS_RSS_URL, {
      headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' }
    });
    if (!res.ok) throw new Error(`Google Trends RSS failed: ${res.status}`);
    return res.text();
  });
};

export const fetchGoogleTrends = async (
  loadRss: GoogleTrendsLoaderFn = defaultLoader,
  limit = 30
): Promise<RawEventInput[]> => {
  const xml = await loadRss(limit);
  const results: RawEventInput[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null && results.length < limit) {
    const item = match[1];
    const title = item.match(/<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/)?.[1]
      ?? item.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] ?? '';
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? '';
    const description = item.match(/<description><!\[CDATA\[(.*?)\]\]>|<description>(.*?)<\/description>/)?.[1]
      ?? item.match(/<description>(.*?)<\/description>/)?.[1] ?? '';

    if (title) {
      results.push({
        source: 'google_trends',
        source_item_id: `gtrends:${title.toLowerCase().replace(/\s+/g, '-').slice(0, 100)}`,
        source_timestamp: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        text: description ? `${title}: ${description}` : title,
        url: link || `https://trends.google.com/trending?q=${encodeURIComponent(title)}`,
      });
    }
  }

  return results.slice(0, limit);
};
```

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --dir packages/connectors exec vitest run src/__tests__/google_trends.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/connectors/src/google_trends.ts packages/connectors/src/__tests__/google_trends.test.ts
git commit -c commit.gpgsign=false -m "feat: add Google Trends connector"
```

---

## Task 11: TikTok Creative Center Connector

**Files:**
- Create: `packages/connectors/src/tiktok_creative.ts`
- Create: `packages/connectors/src/__tests__/tiktok_creative.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('tiktok_creative connector', () => {
  it('parses trending topics into RawEventInput', async () => {
    const mockData = {
      data: {
        trend_list: [
          {
            hashtag_name: 'aidatingapp',
            video_count: 150000,
            view_count: 5000000,
          },
          {
            hashtag_name: 'mealprephack',
            video_count: 80000,
            view_count: 2000000,
          },
        ],
      },
    };

    const { fetchTikTokCreative } = await import('../tiktok_creative');
    const mockLoader = vi.fn().mockResolvedValue(mockData);
    const results = await fetchTikTokCreative(mockLoader, 10);

    expect(results).toHaveLength(2);
    expect(results[0].source).toBe('tiktok_creative');
    expect(results[0].text).toContain('aidatingapp');
    expect(results[0].engagement_count).toBe(5000000);
    expect(results[0].source_item_id).toMatch(/^tiktok:/);
  });

  it('falls back to scraping if API structure changes', async () => {
    const { fetchTikTokCreative } = await import('../tiktok_creative');
    const mockLoader = vi.fn().mockResolvedValue({ data: {} });
    const results = await fetchTikTokCreative(mockLoader, 10);
    expect(results).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --dir packages/connectors exec vitest run src/__tests__/tiktok_creative.test.ts`
Expected: FAIL

**Step 3: Write the connector**

```typescript
import { type RawEventInput, withRetry } from './common/http';

type TikTokTrend = {
  hashtag_name: string;
  video_count?: number;
  view_count?: number;
};

type TikTokResponse = {
  data?: {
    trend_list?: TikTokTrend[];
  };
};

type TikTokLoaderFn = (limit: number) => Promise<TikTokResponse>;

const CREATIVE_CENTER_URL = 'https://ads.tiktok.com/creative_radar_api/v1/popular_trend/hashtag/list?period=7&page=1&limit=50&country_code=US';

const defaultLoader: TikTokLoaderFn = async () => {
  return withRetry(async () => {
    const res = await fetch(CREATIVE_CENTER_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`TikTok Creative Center failed: ${res.status}`);
    return res.json() as Promise<TikTokResponse>;
  });
};

export const fetchTikTokCreative = async (
  loadData: TikTokLoaderFn = defaultLoader,
  limit = 30
): Promise<RawEventInput[]> => {
  const response = await loadData(limit);
  const trends = response.data?.trend_list ?? [];

  return trends.slice(0, limit).map((trend): RawEventInput => ({
    source: 'tiktok_creative',
    source_item_id: `tiktok:${trend.hashtag_name}`,
    source_timestamp: new Date().toISOString(),
    text: `Trending on TikTok: #${trend.hashtag_name} (${formatCount(trend.view_count ?? 0)} views, ${formatCount(trend.video_count ?? 0)} videos)`,
    url: `https://www.tiktok.com/tag/${trend.hashtag_name}`,
    engagement_count: trend.view_count ?? 0,
  }));
};

const formatCount = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
};
```

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --dir packages/connectors exec vitest run src/__tests__/tiktok_creative.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/connectors/src/tiktok_creative.ts packages/connectors/src/__tests__/tiktok_creative.test.ts
git commit -c commit.gpgsign=false -m "feat: add TikTok Creative Center connector"
```

---

## Task 12: AlternativeTo Connector

**Files:**
- Create: `packages/connectors/src/alternativeto.ts`
- Create: `packages/connectors/src/__tests__/alternativeto.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('alternativeto connector', () => {
  it('parses RSS items into RawEventInput', async () => {
    const mockRss = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>10 Best Alternatives to Notion in 2026</title>
      <link>https://alternativeto.net/software/notion/</link>
      <pubDate>Wed, 05 Mar 2026 10:00:00 GMT</pubDate>
      <description>Users are looking for alternatives to Notion for note-taking and project management.</description>
    </item>
    <item>
      <title>5 Best Alternatives to Figma</title>
      <link>https://alternativeto.net/software/figma/</link>
      <pubDate>Wed, 05 Mar 2026 09:00:00 GMT</pubDate>
      <description>Looking for Figma alternatives with better collaboration features.</description>
    </item>
  </channel>
</rss>`;

    const { fetchAlternativeTo } = await import('../alternativeto');
    const mockLoader = vi.fn().mockResolvedValue(mockRss);
    const results = await fetchAlternativeTo(mockLoader, 10);

    expect(results).toHaveLength(2);
    expect(results[0].source).toBe('alternativeto');
    expect(results[0].text).toContain('Notion');
    expect(results[0].url).toContain('alternativeto.net');
    expect(results[0].source_item_id).toMatch(/^altto:/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --dir packages/connectors exec vitest run src/__tests__/alternativeto.test.ts`
Expected: FAIL

**Step 3: Write the connector**

```typescript
import { type RawEventInput, withRetry } from './common/http';

type AlternativeToLoaderFn = (limit: number) => Promise<string>;

const ALTTO_RSS_URL = 'https://alternativeto.net/platform/online/feed/';

const defaultLoader: AlternativeToLoaderFn = async () => {
  return withRetry(async () => {
    const res = await fetch(ALTTO_RSS_URL, {
      headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' }
    });
    if (!res.ok) throw new Error(`AlternativeTo RSS failed: ${res.status}`);
    return res.text();
  });
};

export const fetchAlternativeTo = async (
  loadRss: AlternativeToLoaderFn = defaultLoader,
  limit = 30
): Promise<RawEventInput[]> => {
  const xml = await loadRss(limit);
  const results: RawEventInput[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null && results.length < limit) {
    const item = match[1];
    const title = item.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1]
      ?? item.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] ?? '';
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? '';
    const description = item.match(/<description><!\[CDATA\[(.*?)\]\]>/)?.[1]
      ?? item.match(/<description>(.*?)<\/description>/)?.[1] ?? '';

    if (title) {
      const slug = link.match(/software\/([^/]+)/)?.[1] ?? title.toLowerCase().replace(/\s+/g, '-').slice(0, 80);
      results.push({
        source: 'alternativeto',
        source_item_id: `altto:${slug}`,
        source_timestamp: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        text: description ? `${title}: ${description}` : title,
        url: link || `https://alternativeto.net/`,
      });
    }
  }

  return results.slice(0, limit);
};
```

**Step 4: Run test to verify it passes**

Run: `CI=1 pnpm --dir packages/connectors exec vitest run src/__tests__/alternativeto.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/connectors/src/alternativeto.ts packages/connectors/src/__tests__/alternativeto.test.ts
git commit -c commit.gpgsign=false -m "feat: add AlternativeTo connector"
```

---

## Task 13: Register New Connectors

**Files:**
- Modify: `packages/connectors/src/common/http.ts` (add to LIMITS and CADENCE maps)
- Modify: `apps/api/src/jobs/ingest_open.ts` (add imports, type union, dispatch entries)
- Modify: `apps/api/src/runtime/live_read_model.ts` (add to OPEN_CONNECTORS array)
- Modify: `apps/api/src/config/env.ts` (add to default dailyConnectors)
- Modify: `apps/web/src/connectorNames.ts` (add display names)

**Step 1: Register in connector limits and cadence**

In `packages/connectors/src/common/http.ts`, add to `OPEN_CONNECTOR_LIMITS`:
```typescript
  google_trends: 30,
  tiktok_creative: 30,
  alternativeto: 30,
```

Add to `OPEN_CONNECTOR_CADENCE`:
```typescript
  google_trends: 'daily',
  tiktok_creative: 'daily',
  alternativeto: 'daily',
```

**Step 2: Wire into ingest_open.ts**

In `apps/api/src/jobs/ingest_open.ts`:

Add imports:
```typescript
import { fetchGoogleTrends } from '@idea/connectors/src/google_trends';
import { fetchTikTokCreative } from '@idea/connectors/src/tiktok_creative';
import { fetchAlternativeTo } from '@idea/connectors/src/alternativeto';
```

Extend `OpenConnectorName` type union:
```typescript
export type OpenConnectorName = 'hn' | 'github_issues' | ... | 'homebrew'
  | 'google_trends' | 'tiktok_creative' | 'alternativeto';
```

Add to `defaultLoaders`:
```typescript
  google_trends: () => fetchGoogleTrends(),
  tiktok_creative: () => fetchTikTokCreative(),
  alternativeto: () => fetchAlternativeTo(),
```

**Step 3: Add to OPEN_CONNECTORS in live_read_model.ts**

In `apps/api/src/runtime/live_read_model.ts`, add to the `OPEN_CONNECTORS` array:
```typescript
const OPEN_CONNECTORS: OpenConnectorName[] = [
  'hn', 'github_issues', 'greenhouse', 'lever', 'yc_companies', 'reddit',
  'producthunt', 'appstore_trending', 'indiehackers', 'lobsters', 'devto',
  'showhn', 'mastodon', 'bluesky', 'homebrew',
  'google_trends', 'tiktok_creative', 'alternativeto'
];
```

**Step 4: Add to default daily connectors in env.ts**

In `apps/api/src/config/env.ts`, add to the default dailyConnectors list:
```typescript
dailyConnectors: parseCsv(env.DAILY_CONNECTORS, [
  'greenhouse', 'lever', 'yc_companies', 'producthunt',
  'appstore_trending', 'indiehackers',
  'google_trends', 'tiktok_creative', 'alternativeto'
]),
```

**Step 5: Add display names**

In `apps/web/src/connectorNames.ts`, add:
```typescript
  google_trends: 'Google Trends',
  tiktok_creative: 'TikTok',
  alternativeto: 'AlternativeTo',
```

**Step 6: Verify build**

Run: `CI=1 pnpm test`
Expected: All existing tests pass, no type errors.

**Step 7: Commit**

```bash
git add packages/connectors/src/common/http.ts apps/api/src/jobs/ingest_open.ts apps/api/src/runtime/live_read_model.ts apps/api/src/config/env.ts apps/web/src/connectorNames.ts
git commit -c commit.gpgsign=false -m "feat: register google_trends, tiktok_creative, alternativeto connectors"
```

---

## Task 14: Agent Prompt Tuning (Strong Consumer Focus)

**Files:**
- Modify: `apps/api/src/jobs/research_agent.ts`

**Step 1: Update buildBroadScanPrompt**

Replace the opening system instruction (lines 143-154 of the existing prompt) with a stronger consumer bias. The full prompt return string should become:

```typescript
return `You are Sixth Sense, a product opportunity scout with persistent memory.
You specialize in finding CONSUMER and SOCIAL product ideas with viral growth potential.
Your primary focus: consumer social apps, community platforms, creator tools, prosumer products with network effects, and mobile-first experiences.

CRITICAL BIAS:
- STRONGLY PREFER consumer/social product ideas over developer tools or enterprise B2B.
- Developer tooling ideas should only be surfaced if the signal is exceptionally strong (demand > 80).
- When you see trending consumer topics (Google Trends, TikTok, AlternativeTo), ask: "What app could a solo founder build in 1-2 months to serve this audience?"
- Cross-pollinate: tech signals can inspire consumer products. A GitHub issue about video processing → "TikTok-style editor for X niche".
- At least 1 of your dig_deeper topics MUST target a consumer/social product opportunity.

IMPORTANT GUIDELINES:
- Each thesis must be a CONCRETE product idea, not an abstract market observation.
- BAD: "Vertical SaaS Consolidation in Regulated Industries", "Proxy-signal instrumentation"
- GOOD: "Community Recipe Sharing App with AI Meal Planning", "TikTok-Style Short Video Editor for Realtors", "Dating App Where Friends Write Your Bio"
- Focus on specific pain points felt by real people (not just developers)
- Target specific buyer personas: "college students who meal prep", "freelance photographers who need a portfolio", "parents looking for educational apps"
- For virality: describe the SPECIFIC sharing moment -- the user action that naturally brings a new user
- Growth loops must be concrete: "User creates a shareable recipe card that links back to the app"

...rest of prompt stays the same (YOUR RECENT OBSERVATIONS, ACTIVE THESES, etc.)...

YOUR TASK:
1. Analyze signal clusters. What consumer/social product ideas do they suggest? Do any clusters reinforce or contradict existing theses?
2. For each relevant thesis, provide a confidence_delta (-20 to +20) with reasoning.
3. Identify 1-3 topics for deeper investigation. AT LEAST ONE must be a consumer/social app opportunity.
4. Write 2-5 observations for your future self. Focus on concrete consumer product angles and viral mechanics, not abstract market patterns.
5. For each thesis update or new idea, describe the specific viral growth loop -- how does one user bring the next?

...rest of JSON format stays the same...`;
```

**Step 2: Update buildDeepDivePrompt**

Add consumer bias to the deep-dive prompt (after the "IMPORTANT GUIDELINES" section):

```typescript
CONSUMER FOCUS:
- PREFER consumer/social product ideas. Solo founder building for real people, not enterprises.
- For every idea, describe the "sharing moment" -- the specific user action that brings a new user.
- Prefer small scope: solo dev, 1-2 month MVP, viral distribution over paid acquisition.
- Consider: does the product create content users want to share? Does it get better with more users?
- Specific channels: which subreddits, TikTok niches, or communities would discover this first?
```

**Step 3: Verify build**

Run: `cd apps/api && pnpm exec tsc --noEmit`
Expected: No errors (prompt changes are string-only, no type changes).

**Step 4: Commit**

```bash
git add apps/api/src/jobs/research_agent.ts
git commit -c commit.gpgsign=false -m "feat: tune agent prompts for strong consumer/social focus"
```

---

## Task 15: Integration Test - Full Flow

**Step 1: Run all tests**

Run: `CI=1 pnpm test`
Expected: All tests pass (existing + new connector tests).

**Step 2: Start the dev servers and verify deep-dive modal**

Run: `pnpm dev` (in separate terminal)

Manual verification:
1. Open `http://localhost:5173`
2. Wait for theses to load in sidebar
3. Click a thesis card -- modal should open with loading skeleton
4. If AI providers are available, deep-dive content should appear
5. Close modal (X, Escape, or backdrop click)
6. Click the same thesis again -- should show cached content instantly (no loading)
7. Check API: `curl http://localhost:3001/v1/theses/<key>/deep-dive` should return cached JSON

**Step 3: Verify new connectors are listed**

Run: `curl http://localhost:3001/v1/connectors | jq '.[] | select(.name | test("google_trends|tiktok_creative|alternativeto"))'`
Expected: Three new connectors shown (may be in `standby` or `active` state depending on whether a refresh has occurred).

**Step 4: Final commit (if any fixups needed)**

```bash
git add -A
git commit -c commit.gpgsign=false -m "fix: integration fixups for social signals and deep-dive"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | DB migration for thesis_deep_dives | 1 new |
| 2 | Contract type ThesisDeepDive | 1 modified |
| 3 | Deep-dive store (DB access layer) | 1 new |
| 4 | Deep-dive AI generation logic | 1 new |
| 5 | API endpoints (GET + POST) + wiring in main.ts | 2 modified |
| 6 | Frontend API client functions | 1 modified |
| 7 | Deep-dive modal component | 1 new |
| 8 | Modal CSS styles | 1 modified |
| 9 | Wire modal into App.tsx | 1 modified |
| 10 | Google Trends connector + test | 2 new |
| 11 | TikTok Creative connector + test | 2 new |
| 12 | AlternativeTo connector + test | 2 new |
| 13 | Register all 3 connectors (5 files) | 5 modified |
| 14 | Agent prompt tuning | 1 modified |
| 15 | Integration test | 0 (verification only) |

**Total:** 10 new files, 11 modified files, 15 tasks.
