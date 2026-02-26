# Dashboard Redesign & DB-Backed Feed Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure the dashboard layout for full-width signals, replace the in-memory feed with a 7-day rolling window from Postgres, and add click-to-filter on thesis cards.

**Architecture:** Backend adds a `querySignals()` method to PostgresMemoryStore that queries `signal_memory` with time window, source, and thesis-evidence filters. The feed route switches from `listSignals()` (snapshot) to `querySignals()` (DB). Frontend removes the sidebar, adds a 3-card status row, and wires thesis click-to-filter with a banner.

**Tech Stack:** Fastify, PostgreSQL (signal_memory + thesis_evidence tables), React 18, CSS Grid

---

### Task 1: Add `querySignals` to PostgresMemoryStore

**Files:**
- Modify: `apps/api/src/runtime/postgres_memory_store.ts:199-217,306-336`
- Test: `apps/api/tests/postgres_memory_store.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/tests/postgres_memory_store.test.ts`:

```typescript
describe('querySignals', () => {
  it('returns signals within time window sorted by blended DESC', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    mockQuery.mockResolvedValueOnce({ rows: [] }); // constructor ping
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          signal_id: 's1', topic: 'ai', source: 'hn',
          canonical_text: 'AI tool for devs', observed_at: new Date('2026-02-25'),
          pain: '75', timing: '80', buildability: '60', blended: '73'
        },
        {
          signal_id: 's2', topic: 'hr', source: 'greenhouse',
          canonical_text: 'HR automation gap', observed_at: new Date('2026-02-24'),
          pain: '60', timing: '50', buildability: '70', blended: '58'
        }
      ]
    });
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
    const result = await store.querySignals({ windowDays: 7, page: 1, pageSize: 20 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].signal_id).toBe('s1');
    expect(result.totalItems).toBe(2);
  });

  it('filters by source when provided', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ping
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] }); // count query
    mockQuery.mockResolvedValueOnce({
      rows: [{
        signal_id: 's1', topic: 'ai', source: 'hn',
        canonical_text: 'test', observed_at: new Date(),
        pain: '70', timing: '80', buildability: '60', blended: '72'
      }]
    });
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
    const result = await store.querySignals({ windowDays: 7, page: 1, pageSize: 20, source: 'hn' });
    expect(result.items).toHaveLength(1);
    expect(mockQuery.mock.calls[1][1]).toContain('hn');
  });

  it('filters by thesis key via thesis_evidence join', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ping
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] }); // count
    mockQuery.mockResolvedValueOnce({
      rows: [{
        signal_id: 's1', topic: 'ai', source: 'hn',
        canonical_text: 'test', observed_at: new Date(),
        pain: '70', timing: '80', buildability: '60', blended: '72'
      }]
    });
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
    const result = await store.querySignals({ windowDays: 7, page: 1, pageSize: 20, thesisKey: 'remote-dev-tools' });
    expect(result.items).toHaveLength(1);
    const sql = mockQuery.mock.calls[1][0];
    expect(sql).toContain('thesis_evidence');
    expect(sql).toContain('thesis_candidates');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --dir apps/api exec vitest run tests/postgres_memory_store.test.ts`
Expected: FAIL — `querySignals` doesn't exist.

**Step 3: Implement querySignals**

In `apps/api/src/runtime/postgres_memory_store.ts`, add the return type (after `MemorySignalRow` type at line 209):

```typescript
export type SignalQueryResult = {
  items: MemorySignalRow[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type SignalQueryParams = {
  windowDays: number;
  page: number;
  pageSize: number;
  source?: string;
  thesisKey?: string;
};
```

Add `querySignals` to the `PostgresMemoryStore` type (line 214):

```typescript
querySignals(params: SignalQueryParams): Promise<SignalQueryResult>;
```

Implement `querySignals` inside the factory (after `listAllSignals`, around line 337):

```typescript
async querySignals(params: SignalQueryParams): Promise<SignalQueryResult> {
  const { windowDays, page, pageSize, source, thesisKey } = params;
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  // Time window filter
  conditions.push(`sm.observed_at >= NOW() - INTERVAL '${windowDays} days'`);

  // Source filter
  if (source) {
    conditions.push(`sm.source = $${paramIdx++}`);
    values.push(source);
  }

  // Thesis evidence filter
  let joinClause = '';
  if (thesisKey) {
    joinClause = `
      JOIN thesis_evidence te ON te.signal_id = sm.signal_id
      JOIN thesis_candidates tc ON tc.id = te.thesis_id`;
    conditions.push(`tc.canonical_key = $${paramIdx++}`);
    values.push(thesisKey);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total
  const countSql = `SELECT COUNT(DISTINCT sm.signal_id)::int AS count FROM signal_memory sm ${joinClause} ${whereClause}`;
  const countResult = await pool.query<{ count: number }>(countSql, values);
  const totalItems = countResult.rows[0]?.count ?? 0;

  // Fetch page
  const offset = (page - 1) * pageSize;
  const dataSql = `
    SELECT DISTINCT sm.signal_id, sm.topic, sm.source, sm.canonical_text,
           sm.observed_at, sm.pain, sm.timing, sm.buildability, sm.blended
    FROM signal_memory sm ${joinClause} ${whereClause}
    ORDER BY sm.blended DESC
    LIMIT ${pageSize} OFFSET ${offset}`;
  const dataResult = await pool.query<Record<string, unknown>>(dataSql, values);

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const items: MemorySignalRow[] = dataResult.rows.map((row) => ({
    signal_id: String(row.signal_id ?? ''),
    topic: String(row.topic ?? ''),
    source: String(row.source ?? ''),
    canonical_text: String(row.canonical_text ?? ''),
    observed_at: toIsoString(row.observed_at),
    pain: toNumber(row.pain),
    timing: toNumber(row.timing),
    buildability: toNumber(row.buildability),
    blended: toNumber(row.blended),
  }));

  return {
    items,
    page,
    pageSize,
    totalItems,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
},
```

**Step 4: Run tests**

Run: `CI=1 pnpm test`
Expected: All pass.

**Step 5: Commit**

```bash
git add apps/api/src/runtime/postgres_memory_store.ts apps/api/tests/postgres_memory_store.test.ts
git commit -m "feat: add querySignals with time window, source, and thesis filters"
```

---

### Task 2: Wire DB-backed feed route

**Files:**
- Modify: `apps/api/src/routes/feed.ts:1-95`
- Modify: `apps/api/src/server.ts:12-22,106`
- Test: `apps/api/tests/feed.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/tests/feed.test.ts` (or update existing feed test):

```typescript
describe('GET /v1/signals with DB-backed feed', () => {
  it('accepts window query param', async () => {
    const app = await buildServer({});
    const res = await app.inject({ method: 'GET', url: '/v1/signals?window=7d' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('total_items');
  });

  it('accepts source filter param', async () => {
    const app = await buildServer({});
    const res = await app.inject({ method: 'GET', url: '/v1/signals?source=hn' });
    expect(res.statusCode).toBe(200);
  });

  it('accepts thesis_key filter param', async () => {
    const app = await buildServer({});
    const res = await app.inject({ method: 'GET', url: '/v1/signals?thesis_key=test-key' });
    expect(res.statusCode).toBe(200);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --dir apps/api exec vitest run tests/feed.test.ts`
Expected: FAIL or partial — current feed doesn't use DB query.

**Step 3: Update feed route to use querySignals**

In `apps/api/src/routes/feed.ts`, update the deps type and route handler:

```typescript
import type { FeedRecord } from '@idea/contracts/src/api';
import type { PostgresMemoryStore, MemorySignalRow } from '../runtime/postgres_memory_store';
import type { FastifyInstance } from 'fastify';

const MAX_PAGE_SIZE = 100;
const DEFAULT_WINDOW_DAYS = 7;

const WINDOW_MAP: Record<string, number> = {
  '1d': 1, '7d': 7, '30d': 30, 'all': 365 * 10,
};

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const signalToFeedRecord = (row: MemorySignalRow): FeedRecord => ({
  idea: row.canonical_text,
  score: row.blended,
  top_source: row.source,
  snippet: row.canonical_text.slice(0, 200),
  source_url: null,
  next_action: 'validate_demand',
  updated_at: row.observed_at,
  pain: row.pain,
  timing: row.timing,
  buildability: row.buildability,
});

type FeedDeps = {
  listSignals: () => Promise<FeedRecord[]>;
  memoryStore?: PostgresMemoryStore | null;
};

export const registerFeedRoute = (app: FastifyInstance, deps: FeedDeps) => {
  app.get<{
    Querystring: {
      page?: string;
      page_size?: string;
      window?: string;
      source?: string;
      thesis_key?: string;
    };
  }>('/v1/signals', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'string', pattern: '^[0-9]+$' },
          page_size: { type: 'string', pattern: '^[0-9]+$' },
          window: { type: 'string', enum: ['1d', '7d', '30d', 'all'] },
          source: { type: 'string' },
          thesis_key: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const page = parsePositiveInt(request.query.page, 1);
    const pageSize = Math.min(parsePositiveInt(request.query.page_size, 20), MAX_PAGE_SIZE);
    const windowStr = request.query.window ?? '7d';
    const windowDays = WINDOW_MAP[windowStr] ?? DEFAULT_WINDOW_DAYS;
    const source = request.query.source;
    const thesisKey = request.query.thesis_key;

    // If memoryStore available, use DB query
    if (deps.memoryStore) {
      const result = await deps.memoryStore.querySignals({
        windowDays,
        page,
        pageSize,
        source,
        thesisKey,
      });
      return {
        items: result.items.map(signalToFeedRecord),
        page: result.page,
        page_size: result.pageSize,
        total_items: result.totalItems,
        total_pages: result.totalPages,
        has_next: result.hasNext,
        has_prev: result.hasPrev,
      };
    }

    // Fallback: in-memory snapshot
    let allSignals = await deps.listSignals();
    if (source) {
      allSignals = allSignals.filter((s) => s.top_source === source);
    }
    const totalItems = allSignals.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const offset = (page - 1) * pageSize;
    const items = allSignals.slice(offset, offset + pageSize);

    return {
      items,
      page,
      page_size: pageSize,
      total_items: totalItems,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1,
    };
  });
};
```

**Step 4: Update server.ts to pass memoryStore to feed route**

In `apps/api/src/server.ts`, update the feed route registration (line 106):

```typescript
registerFeedRoute(app, {
  listSignals: resolvedDeps.listSignals,
  memoryStore: resolvedDeps.memoryStore,
});
```

**Step 5: Run tests**

Run: `CI=1 pnpm test`
Expected: All pass. Note: existing tests use `buildServer({})` which has no memoryStore, so they'll use the fallback path.

**Step 6: Commit**

```bash
git add apps/api/src/routes/feed.ts apps/api/src/server.ts apps/api/tests/feed.test.ts
git commit -m "feat: wire DB-backed feed with time window, source, thesis filters"
```

---

### Task 3: Update frontend API client

**Files:**
- Modify: `apps/web/src/api.ts:34-51`

**Step 1: Update fetchSignals to support new query params**

In `apps/web/src/api.ts`, update `fetchSignals`:

```typescript
export const fetchSignals = async ({
  page = 1,
  pageSize = 20,
  window: timeWindow = '7d',
  source,
  thesisKey,
}: {
  page?: number;
  pageSize?: number;
  window?: string;
  source?: string;
  thesisKey?: string;
} = {}): Promise<SignalPage> => {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  params.set('window', timeWindow);
  if (source) params.set('source', source);
  if (thesisKey) params.set('thesis_key', thesisKey);
  const res = await fetch(buildApiUrl(`/v1/signals?${params.toString()}`));
  if (!res.ok) throw new Error(`fetchSignals failed: ${res.status}`);
  return res.json();
};
```

**Step 2: Run tests**

Run: `CI=1 pnpm test`
Expected: All pass.

**Step 3: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat: add window, source, thesisKey params to fetchSignals"
```

---

### Task 4: Create StatusCards component

**Files:**
- Create: `apps/web/src/components/StatusCards.tsx`
- Modify: `apps/web/src/styles.css`

**Step 1: Create the StatusCards component**

Create `apps/web/src/components/StatusCards.tsx`:

```typescript
import React from 'react';
import type { ConnectorRecord, AiHealthRecord, AgentStatusRecord } from '../api';

type StatusCardsProps = {
  connectors: ConnectorRecord[];
  aiHealth: AiHealthRecord | null;
  agentStatus: AgentStatusRecord | null;
};

const statusDot = (status: string): string => {
  if (status === 'active' || status === 'healthy') return 'dot-ok';
  if (status === 'degraded' || status === 'error') return 'dot-err';
  return 'dot-idle';
};

export const StatusCards: React.FC<StatusCardsProps> = ({ connectors, aiHealth, agentStatus }) => {
  const activeConnectors = connectors.filter((c) => c.status === 'active').length;
  const enabledProviders = aiHealth?.providers?.filter((p) => p.enabled) ?? [];

  return (
    <div className="status-cards">
      {/* Connector Health */}
      <div className="status-card">
        <h4>Connector Health</h4>
        <div className="status-card-body">
          {connectors.map((c) => (
            <div key={c.name} className="status-row">
              <span className={`status-dot ${statusDot(c.status)}`} />
              <span className="status-name">{c.name}</span>
              <span className="status-detail">{c.status}</span>
            </div>
          ))}
          {connectors.length === 0 && <p className="status-empty">No connectors</p>}
        </div>
        <div className="status-card-footer">{activeConnectors}/{connectors.length} active</div>
      </div>

      {/* AI Agents */}
      <div className="status-card">
        <h4>AI Agents</h4>
        <div className="status-card-body">
          {enabledProviders.map((p) => (
            <div key={p.provider} className="status-row">
              <span className={`status-dot ${statusDot(p.status)}`} />
              <span className="status-name">{p.provider}</span>
              <span className="status-detail">
                {p.succeeded}ok {p.failed > 0 ? `${p.failed}err` : ''}
              </span>
            </div>
          ))}
          {enabledProviders.length === 0 && <p className="status-empty">No providers</p>}
        </div>
        {aiHealth?.run_id && (
          <div className="status-card-footer">Run: {aiHealth.run_id.slice(0, 12)}</div>
        )}
      </div>

      {/* Research Agent */}
      <div className="status-card">
        <h4>Research Agent</h4>
        <div className="status-card-body">
          {agentStatus?.lastRun ? (
            <>
              <div className="status-row">
                <span className="status-name">Last run</span>
                <span className="status-detail">
                  {new Date(agentStatus.lastRun.timestamp).toLocaleString()}
                </span>
              </div>
              <div className="status-row">
                <span className="status-name">Results</span>
                <span className="status-detail">
                  {agentStatus.lastRun.thesesUpdated} updated, {agentStatus.lastRun.newCandidates} new
                </span>
              </div>
            </>
          ) : (
            <p className="status-empty">No runs yet</p>
          )}
        </div>
        {agentStatus?.investigateNext && (
          <div className="status-card-footer">Next: {agentStatus.investigateNext}</div>
        )}
      </div>
    </div>
  );
};
```

**Step 2: Add CSS styles**

Add to `apps/web/src/styles.css` (after the thesis styles, before signal styles):

```css
/* ── Status Cards Row ────────────────────────────────── */
.status-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.9rem;
  margin-bottom: 1.2rem;
}

.status-card {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.8rem 1rem;
}

.status-card h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}

.status-card-body {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
}

.status-name {
  flex: 1;
  color: var(--fg);
}

.status-detail {
  color: var(--muted);
  font-size: 0.75rem;
}

.status-empty {
  color: var(--muted);
  font-size: 0.8rem;
  margin: 0;
}

.status-card-footer {
  margin-top: 0.5rem;
  padding-top: 0.4rem;
  border-top: 1px solid var(--border);
  font-size: 0.7rem;
  color: var(--muted);
}
```

**Step 3: Run tests**

Run: `CI=1 pnpm test`
Expected: All pass.

**Step 4: Commit**

```bash
git add apps/web/src/components/StatusCards.tsx apps/web/src/styles.css
git commit -m "feat: add StatusCards component (connectors, AI agents, research agent)"
```

---

### Task 5: Restructure App.tsx layout

**Files:**
- Modify: `apps/web/src/App.tsx:57-76,258,298-372`
- Modify: `apps/web/src/styles.css:601-606`

**Step 1: Add thesis filter state and update App.tsx**

In `apps/web/src/App.tsx`, make these changes:

1. Add new state variables (near existing state declarations around line 57):

```typescript
const [thesisFilter, setThesisFilter] = useState<string | null>(null);
const [thesisFilterTitle, setThesisFilterTitle] = useState<string>('');
```

2. Update the `fetchSignals` call (around line 97) to pass the new params:

```typescript
fetchSignals({
  page: requestedPage,
  pageSize: PAGE_SIZE,
  source: sourceFilter === 'all' ? undefined : sourceFilter,
  thesisKey: thesisFilter ?? undefined,
})
```

3. Add `thesisFilter` and `sourceFilter` to the useEffect dependency array that triggers signal refetch.

4. Remove `filteredSignals` client-side filtering logic — the server now handles source filtering.

5. Replace the content-grid section (lines 313-372). Remove `<AgentSidebar>` and the 2-column grid. Replace with:

```tsx
{/* Status Cards Row */}
<StatusCards
  connectors={connectors}
  aiHealth={aiHealth}
  agentStatus={agentStatus}
/>

{/* Thesis filter banner */}
{thesisFilter && (
  <div className="thesis-filter-banner">
    <span>Showing signals for: <strong>{thesisFilterTitle}</strong></span>
    <button onClick={() => { setThesisFilter(null); setThesisFilterTitle(''); }}>
      Clear filter
    </button>
  </div>
)}

{/* Opportunity Signals — full width */}
<div className="card">
  {/* ... existing signal header, pagination, signal list ... */}
</div>
```

6. Update the thesis board section. Make ThesisCard clickable:

```tsx
<div className="thesis-board">
  {displayTheses.map((t) => (
    <ThesisCard
      key={t.canonicalKey}
      thesis={t}
      isActive={thesisFilter === t.canonicalKey}
      onClick={() => {
        if (thesisFilter === t.canonicalKey) {
          setThesisFilter(null);
          setThesisFilterTitle('');
        } else {
          setThesisFilter(t.canonicalKey);
          setThesisFilterTitle(t.title);
          setRequestedPage(1);
        }
      }}
    />
  ))}
</div>
```

7. Remove the `<AgentSidebar>` import and add `<StatusCards>` import.

8. Remove the `uniqueSources` memo and `filteredSignals` computation — source filtering is now server-side.

**Step 2: Update CSS**

Replace `.content-grid` in `apps/web/src/styles.css` (lines 601-606):

```css
/* Remove old 2-column grid — signals are now full width */
```

Add thesis filter banner styles:

```css
.thesis-filter-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1rem;
  margin-bottom: 0.9rem;
  background: var(--surface-2);
  border: 1px solid var(--accent);
  border-radius: 8px;
  font-size: 0.85rem;
}

.thesis-filter-banner button {
  background: transparent;
  border: 1px solid var(--muted);
  color: var(--fg);
  padding: 0.25rem 0.6rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
}

.thesis-filter-banner button:hover {
  border-color: var(--accent);
}
```

**Step 3: Run tests**

Run: `CI=1 pnpm test`
Expected: All pass. Update existing app.test.tsx if it references AgentSidebar or the 2-column layout.

**Step 4: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/styles.css
git commit -m "feat: restructure layout — full-width signals, status cards, thesis filter"
```

---

### Task 6: Enhance ThesisCard with click and more detail

**Files:**
- Modify: `apps/web/src/components/ThesisCard.tsx:1-44`
- Modify: `apps/web/src/styles.css`

**Step 1: Update ThesisCard component**

Replace `apps/web/src/components/ThesisCard.tsx`:

```typescript
import React from 'react';

export type ThesisCardProps = {
  thesis: {
    canonicalKey: string;
    title: string;
    confidence: number;
    status: string;
    evidenceCount: number;
    problemStatement: string;
    sourceCount: number;
  };
  isActive?: boolean;
  onClick?: () => void;
};

const confidenceColor = (confidence: number): string => {
  if (confidence >= 70) return 'var(--ok)';
  if (confidence >= 40) return 'var(--warn)';
  return 'var(--muted)';
};

export const ThesisCard: React.FC<ThesisCardProps> = ({ thesis, isActive, onClick }) => {
  const statusClass = thesis.status === 'promoted' ? 'promoted' : thesis.status === 'watching' ? 'watching' : '';

  return (
    <div
      className={`thesis-card ${statusClass} ${isActive ? 'thesis-active' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      <div className="thesis-header">
        <h3 className="thesis-title">{thesis.title}</h3>
        <span className="thesis-confidence" style={{ color: confidenceColor(thesis.confidence) }}>
          {thesis.confidence}%
        </span>
      </div>
      <div className="thesis-confidence-bar">
        <div
          className="thesis-confidence-fill"
          style={{ width: `${Math.min(thesis.confidence, 100)}%`, background: confidenceColor(thesis.confidence) }}
        />
      </div>
      <p className="thesis-problem">{thesis.problemStatement}</p>
      <div className="thesis-meta">
        <span className={`thesis-status ${statusClass}`}>{thesis.status}</span>
        <span>{thesis.evidenceCount} evidence</span>
        <span>{thesis.sourceCount} sources</span>
      </div>
    </div>
  );
};
```

**Step 2: Add active/clickable styles**

Add to `apps/web/src/styles.css`:

```css
.thesis-card[role="button"] {
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.thesis-card[role="button"]:hover {
  border-color: var(--accent);
}

.thesis-active {
  border-color: var(--accent) !important;
  box-shadow: 0 0 0 1px var(--accent);
}
```

**Step 3: Run tests**

Run: `CI=1 pnpm test`
Expected: All pass. Fix any test that references ThesisCard props that changed.

**Step 4: Commit**

```bash
git add apps/web/src/components/ThesisCard.tsx apps/web/src/styles.css
git commit -m "feat: make ThesisCard clickable with active state and enhanced detail"
```

---

### Task 7: Update web tests for new layout

**Files:**
- Modify: `apps/web/tests/app.test.tsx`

**Step 1: Update tests for new layout**

Read `apps/web/tests/app.test.tsx`. Update:
- Remove assertions about AgentSidebar (sidebar no longer exists)
- Add assertion for StatusCards rendering
- Test thesis click-to-filter behavior
- Update any signal-related assertions for the new full-width layout
- Update source filter assertions (now server-side, not client-side)

Key test updates:

```typescript
it('renders status cards', () => {
  // verify "Connector Health", "AI Agents", "Research Agent" headings exist
});

it('clicking thesis card sets filter', async () => {
  // click a thesis card → verify filter banner appears
  // click clear → verify filter banner disappears
});
```

**Step 2: Run tests**

Run: `CI=1 pnpm test`
Expected: All pass.

**Step 3: Commit**

```bash
git add apps/web/tests/app.test.tsx
git commit -m "test: update web tests for new dashboard layout"
```

---

### Task 8: Remove AgentSidebar component

**Files:**
- Delete: `apps/web/src/components/AgentSidebar.tsx`
- Modify: `apps/web/src/styles.css` (remove `.agent-sidebar` styles)

**Step 1: Delete AgentSidebar.tsx**

```bash
rm apps/web/src/components/AgentSidebar.tsx
```

**Step 2: Remove sidebar CSS**

Remove `.agent-sidebar`, `.agent-run-info`, `.agent-stats`, `.agent-last-run`, `.agent-pending`, `.agent-next`, `.agent-next-label`, `.agent-next-topic` styles and the `.content-grid` two-column grid from `apps/web/src/styles.css`.

**Step 3: Run tests**

Run: `CI=1 pnpm test`
Expected: All pass.

**Step 4: Commit**

```bash
git add -u apps/web/src/components/AgentSidebar.tsx apps/web/src/styles.css
git commit -m "refactor: remove AgentSidebar, replaced by StatusCards"
```

---

### Task 9: Final verification

**Step 1: Run complete test suite**

Run: `CI=1 pnpm test`
Expected: All tests pass.

**Step 2: Run lint**

Run: `pnpm run lint`
Expected: Clean.

**Step 3: Visual verification**

Start the dev server and verify:
- Signals show 7-day rolling window (should be 100+ signals if DB has data)
- Clicking a thesis filters signals, shows banner
- Clearing filter restores all signals
- Status cards show connector/AI/agent info
- Signals use full width
- Source filter dropdown still works (now server-side)
- Pagination works correctly

Run: `pnpm --dir apps/web dev`
Open: `http://localhost:5173`

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: final adjustments from visual verification"
```
