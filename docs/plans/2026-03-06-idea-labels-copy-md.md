# Idea Labels & Copy-as-Markdown Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add user labels (favourite/later/dismissed) to ideas with filtering, and a copy-as-markdown button on the deep-dive modal.

**Architecture:** Single nullable `label` column on `thesis_candidates` table. New `PATCH /v1/theses/:key/label` endpoint. Frontend label toggle buttons on ThesisCard, label filter dropdown in pane header, and copy button in ThesisDeepDiveModal. Dismissed ideas are visually muted (not hidden).

**Tech Stack:** PostgreSQL migration, Fastify route, React components, custom CSS.

---

### Task 1: DB Migration

**Files:**
- Create: `apps/api/db/migrations/0017_thesis_labels.sql`

**Step 1: Create migration file**

```sql
ALTER TABLE thesis_candidates
  ADD COLUMN IF NOT EXISTS label TEXT DEFAULT NULL
  CHECK (label IS NULL OR label IN ('favourite', 'later', 'dismissed'));

CREATE INDEX IF NOT EXISTS idx_thesis_candidates_label
  ON thesis_candidates (label) WHERE label IS NOT NULL;
```

**Step 2: Run migration**

Run: `bash scripts/db-migrate.sh`
Expected: "All migrations complete." with no errors

**Step 3: Commit**

```bash
git add apps/api/db/migrations/0017_thesis_labels.sql
git commit -m "feat: add label column to thesis_candidates"
```

---

### Task 2: Contracts - Add `label` to API types

**Files:**
- Modify: `packages/contracts/src/api.ts` (ThesisListItem type, ~line 107-119)

**Step 1: Add label to ThesisListItem**

Add `label` field to `ThesisListItem`:

```typescript
export type ThesisListItem = {
  canonicalKey: string;
  title: string;
  confidence: number;
  status: string;
  evidenceCount: number;
  problemStatement: string;
  sourceCount: number;
  estimatedScope: 'small' | 'medium' | 'large' | null;
  lastSeenAt: string;
  hasDeepDive: boolean;
  profileId?: string;
  label: 'favourite' | 'later' | 'dismissed' | null;
};
```

**Step 2: Commit**

```bash
git add packages/contracts/src/api.ts
git commit -m "feat: add label field to ThesisListItem contract"
```

---

### Task 3: Backend - Read label from DB, expose in list

**Files:**
- Modify: `apps/api/src/runtime/postgres_thesis_store.ts` (~line 6-58, 200-246)

**Step 1: Add label to ThesisRow type**

Add `label: string | null;` to the `ThesisRow` type at line 6.

**Step 2: Add label to rowToDraft mapping**

The `rowToDraft` function returns `ThesisDraft & { sourceCount: number }`. Add `label` to its return:

After `profileId: row.profile_id ?? 'consumer'` add:
```typescript
label: row.label ?? null
```

**Step 3: Add label to listPaginated response mapping**

In `listPaginated`, at the items mapping (~line 225-237), add to each item:
```typescript
label: (d as any).label ?? null
```

**Step 4: Add label filter to listPaginated WHERE clauses**

In `listPaginated`, accept a new `label` param. After the profile WHERE clause (~line 158-161):

```typescript
if (label) {
  countParams.push(label);
  whereClauses.push(`label = $${countParams.length}`);
}
```

Update the function signature to include `label?: string`.

**Step 5: Run existing tests**

Run: `CI=1 pnpm --dir apps/api exec vitest run tests/postgres_thesis_store.test.ts`
Expected: All existing tests pass

**Step 6: Commit**

```bash
git add apps/api/src/runtime/postgres_thesis_store.ts
git commit -m "feat: read/filter label in postgres thesis store"
```

---

### Task 4: Backend - PATCH label endpoint + label query filter

**Files:**
- Modify: `apps/api/src/routes/theses.ts` (~add after line 75)
- Modify: `apps/api/src/runtime/thesis_store.ts` (add setLabel to ThesisStore interface)
- Modify: `apps/api/src/runtime/postgres_thesis_store.ts` (implement setLabel)

**Step 1: Write failing test for PATCH endpoint**

Create test in `apps/api/tests/theses-api.test.ts`. Add:

```typescript
it('PATCH /v1/theses/:key/label sets label', async () => {
  const store = new InMemoryThesisStore();
  await store.upsert({
    canonicalKey: 'label-test',
    title: 'Label Test',
    topic: 't',
    status: 'candidate',
    confidence: 50,
    scoreTotal: 50,
    problemStatement: 'p',
    targetBuyer: 'b',
    proposedSolution: 's',
    evidenceCount: 1,
    avgDemand: 50,
    avgTiming: 50,
    avgBuildability: 50,
    avgVirality: 0,
    latestObservedAt: '2026-02-25T10:00:00Z',
    evidence: []
  });

  const app = await buildServer({ thesisStore: store });
  servers.push(app);

  const response = await app.inject({
    method: 'PATCH',
    url: '/v1/theses/label-test/label',
    payload: { label: 'favourite' }
  });

  expect(response.statusCode).toBe(200);
  expect(response.json().label).toBe('favourite');
});

it('PATCH /v1/theses/:key/label with null removes label', async () => {
  const store = new InMemoryThesisStore();
  await store.upsert({
    canonicalKey: 'label-test2',
    title: 'Label Test 2',
    topic: 't',
    status: 'candidate',
    confidence: 50,
    scoreTotal: 50,
    problemStatement: 'p',
    targetBuyer: 'b',
    proposedSolution: 's',
    evidenceCount: 1,
    avgDemand: 50,
    avgTiming: 50,
    avgBuildability: 50,
    avgVirality: 0,
    latestObservedAt: '2026-02-25T10:00:00Z',
    evidence: []
  });

  const app = await buildServer({ thesisStore: store });
  servers.push(app);

  const response = await app.inject({
    method: 'PATCH',
    url: '/v1/theses/label-test2/label',
    payload: { label: null }
  });

  expect(response.statusCode).toBe(200);
  expect(response.json().label).toBeNull();
});

it('PATCH /v1/theses/:key/label rejects invalid label', async () => {
  const store = new InMemoryThesisStore();
  const app = await buildServer({ thesisStore: store });
  servers.push(app);

  const response = await app.inject({
    method: 'PATCH',
    url: '/v1/theses/any-key/label',
    payload: { label: 'invalid' }
  });

  expect(response.statusCode).toBe(400);
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --dir apps/api exec vitest run tests/theses-api.test.ts`
Expected: FAIL

**Step 3: Add `setLabel` to ThesisStore interface and InMemoryThesisStore**

In `apps/api/src/runtime/thesis_store.ts`:

Add to the `ThesisStore` interface:
```typescript
setLabel(canonicalKey: string, label: 'favourite' | 'later' | 'dismissed' | null): Promise<{ label: string | null } | null>;
```

Add to `InMemoryThesisStore`:
```typescript
async setLabel(canonicalKey: string, label: 'favourite' | 'later' | 'dismissed' | null): Promise<{ label: string | null } | null> {
  const draft = this.store.get(canonicalKey);
  if (!draft) return null;
  (draft as any).label = label;
  return { label };
}
```

**Step 4: Implement setLabel in PostgresThesisStore**

In `apps/api/src/runtime/postgres_thesis_store.ts`, add after the `close` method:

```typescript
async setLabel(canonicalKey: string, label: 'favourite' | 'later' | 'dismissed' | null): Promise<{ label: string | null } | null> {
  const result = await pool.query<{ label: string | null }>(
    `UPDATE thesis_candidates SET label = $1, updated_at = NOW()
     WHERE canonical_key = $2
     RETURNING label`,
    [label, canonicalKey]
  );
  return result.rows[0] ?? null;
},
```

**Step 5: Add PATCH route in theses.ts**

In `apps/api/src/routes/theses.ts`, after the GET `/v1/theses/:key` route handler (~line 75), add:

```typescript
const validLabels = new Set(['favourite', 'later', 'dismissed']);

app.patch('/v1/theses/:key/label', {
  schema: {
    params: {
      type: 'object',
      properties: { key: { type: 'string', minLength: 1, maxLength: 200 } },
      required: ['key']
    },
    body: {
      type: 'object',
      properties: {
        label: { type: ['string', 'null'] }
      },
      required: ['label']
    }
  }
}, async (request, reply) => {
  const { key } = request.params as { key: string };
  const { label } = request.body as { label: string | null };

  if (label !== null && !validLabels.has(label)) {
    reply.code(400);
    return { error: `Invalid label. Must be one of: ${[...validLabels].join(', ')} or null` };
  }

  if (!('setLabel' in deps.store)) {
    reply.code(503);
    return { error: 'Label updates not supported' };
  }

  const result = await (deps.store as any).setLabel(key, label);
  if (!result) {
    reply.code(404);
    return { error: 'Thesis not found' };
  }

  return result;
});
```

**Step 6: Add `?label=` filter to GET /v1/theses**

In the GET `/v1/theses` handler, add `label` to the query type and pass it through:

```typescript
const query = request.query as { page?: string; page_size?: string; status?: string; sort?: string; profile?: string; label?: string };
```

And pass `label` to `listPaginated`:
```typescript
...(query.label ? { label: query.label } : {})
```

**Step 7: Run tests**

Run: `CI=1 pnpm --dir apps/api exec vitest run tests/theses-api.test.ts`
Expected: All pass

**Step 8: Commit**

```bash
git add apps/api/src/routes/theses.ts apps/api/src/runtime/thesis_store.ts apps/api/src/runtime/postgres_thesis_store.ts apps/api/tests/theses-api.test.ts
git commit -m "feat: PATCH /v1/theses/:key/label endpoint with validation"
```

---

### Task 5: Frontend API client - add label functions

**Files:**
- Modify: `apps/web/src/api.ts`

**Step 1: Add setThesisLabel function**

After `generateThesisDeepDive` function:

```typescript
export type ThesisLabel = 'favourite' | 'later' | 'dismissed' | null;

export const setThesisLabel = async (canonicalKey: string, label: ThesisLabel): Promise<{ label: ThesisLabel }> => {
  const response = await fetch(
    buildApiUrl(`/v1/theses/${encodeURIComponent(canonicalKey)}/label`),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label })
    }
  );
  if (!response.ok) throw new Error(`setThesisLabel failed: ${response.status}`);
  return response.json();
};
```

**Step 2: Add `label` query param to fetchTheses**

Update `fetchTheses` to accept and forward a `label` param:

```typescript
export const fetchTheses = async ({
  page = 1,
  pageSize = 10,
  status,
  sort = 'score',
  profile,
  label,
}: {
  page?: number;
  pageSize?: number;
  status?: string;
  sort?: ThesisSortField;
  profile?: string;
  label?: string;
} = {}): Promise<ThesisPage> => {
```

And add before the fetch call:
```typescript
if (label) params.set('label', label);
```

**Step 3: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat: frontend API client for thesis labels"
```

---

### Task 6: ThesisCard - label toggle buttons

**Files:**
- Modify: `apps/web/src/components/ThesisCard.tsx`

**Step 1: Add label props and toggle buttons**

Update `ThesisCardProps` to include:
```typescript
thesis: {
  // ... existing fields ...
  label?: 'favourite' | 'later' | 'dismissed' | null;
};
onLabelChange?: (label: 'favourite' | 'later' | 'dismissed' | null) => void;
```

Add label buttons in the `thesis-meta` div, before the explore button:

```tsx
{onLabelChange && (
  <span className="thesis-label-btns">
    <button
      type="button"
      className={`thesis-label-btn ${thesis.label === 'favourite' ? 'active favourite' : ''}`}
      title="Favourite"
      onClick={(e) => { e.stopPropagation(); onLabelChange(thesis.label === 'favourite' ? null : 'favourite'); }}
    >
      {thesis.label === 'favourite' ? '\u2605' : '\u2606'}
    </button>
    <button
      type="button"
      className={`thesis-label-btn ${thesis.label === 'later' ? 'active later' : ''}`}
      title="Later"
      onClick={(e) => { e.stopPropagation(); onLabelChange(thesis.label === 'later' ? null : 'later'); }}
    >
      {'\u23F0'}
    </button>
    <button
      type="button"
      className={`thesis-label-btn ${thesis.label === 'dismissed' ? 'active dismissed' : ''}`}
      title="Dismiss"
      onClick={(e) => { e.stopPropagation(); onLabelChange(thesis.label === 'dismissed' ? null : 'dismissed'); }}
    >
      {'\u2715'}
    </button>
  </span>
)}
```

Add `thesis-dismissed` class to the card root when label is dismissed:
```tsx
<div className={`thesis-card ${statusClass} ${isActive ? 'thesis-active' : ''} ${thesis.label === 'dismissed' ? 'thesis-dismissed' : ''}`}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/ThesisCard.tsx
git commit -m "feat: label toggle buttons on ThesisCard"
```

---

### Task 7: ThesisDeepDiveModal - copy as markdown

**Files:**
- Modify: `apps/web/src/components/ThesisDeepDiveModal.tsx`

**Step 1: Add copy-as-markdown button**

Add a `buildMarkdown` helper inside the component:

```typescript
const buildMarkdown = (): string => {
  const lines = [
    `# ${thesis.title}`,
    '',
    `**Confidence:** ${thesis.confidence}%${thesis.estimatedScope ? ` | **Scope:** ${thesis.estimatedScope}` : ''} | **Evidence:** ${thesis.evidenceCount} | **Sources:** ${thesis.sourceCount}`,
    '',
    `## Problem`,
    thesis.problemStatement,
  ];
  if (data) {
    lines.push('', `## What is this?`, data.summary);
    lines.push('', `## How it works`, data.howItWorks);
    lines.push('', `## Growth strategy`, data.growthStrategy);
    lines.push('', `## Build suggestions`, data.buildSuggestions);
  }
  return lines.join('\n');
};
```

Add a "Copy MD" button in the `deep-dive-header`, between the title and the close button:

```tsx
<div className="deep-dive-header">
  <h2 className="deep-dive-title">{thesis.title}</h2>
  <div className="deep-dive-header-actions">
    {data && (
      <button
        className="deep-dive-copy-btn"
        onClick={() => {
          navigator.clipboard.writeText(buildMarkdown());
        }}
        type="button"
        title="Copy as Markdown"
      >
        Copy MD
      </button>
    )}
    <button className="deep-dive-close" onClick={onClose} type="button">&times;</button>
  </div>
</div>
```

**Step 2: Commit**

```bash
git add apps/web/src/components/ThesisDeepDiveModal.tsx
git commit -m "feat: copy-as-markdown button in deep-dive modal"
```

---

### Task 8: App.tsx - wire label state, filter, and API calls

**Files:**
- Modify: `apps/web/src/App.tsx`

**Step 1: Import setThesisLabel and ThesisLabel**

Add to the import from `./api`:
```typescript
setThesisLabel,
type ThesisLabel,
```

**Step 2: Add label filter state**

After `activeProfile` state:
```typescript
const [labelFilter, setLabelFilter] = useState<string>('all');
```

**Step 3: Pass label filter to fetchTheses**

In both thesis fetch locations (the `useEffect` at ~line 295 and the agent-complete refresh at ~line 235), add:
```typescript
...(labelFilter !== 'all' ? { label: labelFilter } : {})
```

Add `labelFilter` to the useEffect dependency array at line 320.

**Step 4: Add handleLabelChange callback**

```typescript
const handleLabelChange = useCallback(async (canonicalKey: string, label: ThesisLabel) => {
  try {
    await setThesisLabel(canonicalKey, label);
    setTheses((prev) => prev.map((t) =>
      t.canonicalKey === canonicalKey ? { ...t, label } : t
    ));
  } catch {
    showToast('Failed to update label', 'error');
  }
}, [showToast]);
```

**Step 5: Add label filter dropdown in pane header**

In the left pane header, after the profile tabs:
```tsx
<select
  className="source-filter"
  value={labelFilter}
  onChange={(e) => { setLabelFilter(e.target.value); setRequestedThesisPage(1); }}
>
  <option value="all">All Labels</option>
  <option value="favourite">Favourites</option>
  <option value="later">Later</option>
  <option value="dismissed">Dismissed</option>
</select>
```

**Step 6: Pass onLabelChange to ThesisCard**

```tsx
<ThesisCard
  key={t.canonicalKey}
  thesis={t}
  // ... existing props ...
  onLabelChange={(label) => handleLabelChange(t.canonicalKey, label)}
/>
```

**Step 7: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat: wire label state, filter, and API calls"
```

---

### Task 9: CSS styles for labels

**Files:**
- Modify: `apps/web/src/styles.css`

**Step 1: Add label button styles**

After the `.thesis-explore-btn.generating` block (~line 897), add:

```css
/* Thesis label buttons */
.thesis-label-btns {
  display: inline-flex;
  gap: 2px;
  margin-left: auto;
}

.thesis-label-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 0.72rem;
  padding: 1px 4px;
  border-radius: 3px;
  color: var(--muted);
  opacity: 0.4;
  transition: opacity 0.12s, color 0.12s, background 0.12s;
  line-height: 1;
}

.thesis-card:hover .thesis-label-btn,
.thesis-label-btn.active {
  opacity: 1;
}

.thesis-label-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  opacity: 1;
}

.thesis-label-btn.active.favourite {
  color: #fbbf24;
}

.thesis-label-btn.active.later {
  color: var(--accent);
}

.thesis-label-btn.active.dismissed {
  color: var(--err);
}

/* Dismissed thesis card muted */
.thesis-card.thesis-dismissed {
  opacity: 0.45;
}

.thesis-card.thesis-dismissed:hover {
  opacity: 0.7;
}
```

**Step 2: Add deep-dive copy button styles**

After the `.deep-dive-close:hover` block (~line 1433), add:

```css
.deep-dive-header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.deep-dive-copy-btn {
  background: var(--surface-2);
  border: 1px solid var(--glass-border);
  color: var(--muted);
  font-family: 'Geist Mono', 'GeistMono', monospace;
  font-size: 0.68rem;
  font-weight: 500;
  padding: 0.25rem 0.6rem;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  white-space: nowrap;
}

.deep-dive-copy-btn:hover {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
```

**Step 3: Verify CSS builds**

Run: `pnpm --filter @idea/web run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add apps/web/src/styles.css
git commit -m "feat: CSS for label buttons and copy-md button"
```

---

### Task 10: Run all tests

**Step 1: Run full test suite**

Run: `CI=1 pnpm test`
Expected: All tests pass (247+ tests)

**Step 2: Verify build**

Run: `pnpm --filter @idea/web run build`
Expected: Build succeeds with no errors

---

### Task 11: Final commit and PR

**Step 1: Create feature branch if not already on one**

```bash
git checkout -b feat/idea-labels-copy-md dev
```

(If already on a feature branch, skip.)

**Step 2: Push and create PR**

```bash
git push -u origin feat/idea-labels-copy-md
gh pr create --base dev --title "feat: idea labels and copy-as-markdown" --body "..."
```
