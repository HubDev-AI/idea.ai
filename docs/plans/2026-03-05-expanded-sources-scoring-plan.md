# Expanded Sources + Scoring Intelligence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 6 new connectors (Mastodon, Lobsters, Show HN, Bluesky, Dev.to, Homebrew Analytics) and scoring intelligence improvements (engagement weighting, multi-source convergence boost).

**Architecture:** Each connector follows the established pattern: loader function with DI for testing, registered in `OPEN_CONNECTOR_LIMITS`, `OPEN_CONNECTOR_CADENCE`, `ingest_open.ts`, `live_read_model.ts`, and `Sidebar.tsx`. Scoring improvements add `engagement_count` to `RawEventInput` and convergence detection in the memory store.

**Tech Stack:** TypeScript, Vitest, Fastify, PostgreSQL (pgvector), existing `fetchJsonWithRetry`/`withRetry` helpers.

---

### Task 1: Lobsters Connector

**Files:**
- Create: `packages/connectors/src/lobsters.ts`
- Create: `packages/connectors/tests/lobsters.test.ts`
- Modify: `packages/connectors/src/common/http.ts` (add to OPEN_CONNECTOR_LIMITS + CADENCE)
- Modify: `apps/api/src/jobs/ingest_open.ts` (add import, type, loader, order)
- Modify: `apps/api/src/runtime/live_read_model.ts` (add to OPEN_CONNECTORS array)
- Modify: `apps/web/src/components/Sidebar.tsx` (add display name)

**Step 1: Write the test**

```typescript
// packages/connectors/tests/lobsters.test.ts
import { describe, expect, it } from 'vitest';
import { fetchLobstersEvents } from '../src/lobsters';

describe('lobsters connector', () => {
  it('maps JSON items to RawEventInput', async () => {
    const mockLoader = async () => [{
      short_id: 'abc123',
      created_at: '2026-03-05T10:00:00.000Z',
      title: 'A new CLI tool for managing dotfiles',
      url: 'https://example.com/dotfiles',
      score: 42,
      comment_count: 8,
      tags: ['devops', 'programming']
    }];

    const events = await fetchLobstersEvents(mockLoader, 25);
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('lobsters');
    expect(events[0].text).toContain('dotfiles');
    expect(events[0].url).toBe('https://example.com/dotfiles');
  });

  it('respects limit', async () => {
    const mockLoader = async () => Array.from({ length: 50 }, (_, i) => ({
      short_id: `id${i}`,
      created_at: new Date().toISOString(),
      title: `Story ${i}`,
      url: `https://example.com/${i}`,
      score: 10,
      comment_count: 2,
      tags: ['programming']
    }));

    const events = await fetchLobstersEvents(mockLoader, 5);
    expect(events).toHaveLength(5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --dir packages/connectors exec vitest run tests/lobsters.test.ts`
Expected: FAIL — module not found

**Step 3: Write connector implementation**

```typescript
// packages/connectors/src/lobsters.ts
import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput } from './common/http';

type LobstersItem = {
  short_id: string;
  created_at: string;
  title: string;
  url: string;
  score: number;
  comment_count: number;
  tags: string[];
};

type LobstersLoaderFn = () => Promise<LobstersItem[]>;

const defaultLoader: LobstersLoaderFn = async () =>
  fetchJsonWithRetry<LobstersItem[]>('https://lobste.rs/hottest.json', {
    init: { headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' } }
  });

export const fetchLobstersEvents = async (
  loadItems: LobstersLoaderFn = defaultLoader,
  limit = OPEN_CONNECTOR_LIMITS.lobsters
): Promise<RawEventInput[]> => {
  const items = await loadItems();

  return items
    .slice(0, limit)
    .filter((item) => item.short_id && item.title)
    .map((item) => ({
      source: 'lobsters',
      source_item_id: `lobsters:${item.short_id}`,
      source_timestamp: item.created_at || new Date().toISOString(),
      text: item.title,
      url: item.url || `https://lobste.rs/s/${item.short_id}`
    }));
};
```

**Step 4: Run test to verify it passes**

Run: `pnpm --dir packages/connectors exec vitest run tests/lobsters.test.ts`
Expected: PASS

**Step 5: Register connector**

Add to `OPEN_CONNECTOR_LIMITS`: `lobsters: 25`
Add to `OPEN_CONNECTOR_CADENCE`: `lobsters: 'daily'`
Add to `ingest_open.ts`: import, type union, CONNECTOR_ORDER, defaultLoaders
Add to `live_read_model.ts`: OPEN_CONNECTORS array
Add to `Sidebar.tsx`: `lobsters: 'Lobsters'`

**Step 6: Run all tests**

Run: `CI=1 pnpm test`
Expected: All pass

**Step 7: Commit**

```bash
git add packages/connectors/src/lobsters.ts packages/connectors/tests/lobsters.test.ts \
  packages/connectors/src/common/http.ts apps/api/src/jobs/ingest_open.ts \
  apps/api/src/runtime/live_read_model.ts apps/web/src/components/Sidebar.tsx
git commit -m "feat: add Lobsters connector"
```

---

### Task 2: Dev.to Connector

Same pattern as Task 1. Source: `devto`. API: `https://dev.to/api/articles?tag=devtools&top=7&per_page=30`. Fields: `id`, `title`, `description`, `url`, `published_at`, `public_reactions_count`, `comments_count`. Cadence: daily. Limit: 30.

---

### Task 3: Show HN Connector

Separate connector (not enhancement to HN) to keep concerns isolated.
Source: `showhn`. API: `https://hn.algolia.com/api/v1/search?tags=show_hn&numericFilters=points>15&hitsPerPage=25`.
Cadence: hourly. Limit: 25.

---

### Task 4: Mastodon Connector

Source: `mastodon`. Polls fosstodon.org + hachyderm.io for tags #devtools, #buildinpublic, #opensource.
API: `GET /api/v1/timelines/tag/{tag}?limit=40`. No auth needed.
Cadence: daily. Limit: 30.

---

### Task 5: Bluesky Connector

Source: `bluesky`. API: `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q={query}&limit=25`.
Queries: "building in public", "launched my app", "side project", "dev tool".
Cadence: daily. Limit: 30.

---

### Task 6: Homebrew Analytics Connector

Source: `homebrew`. API: `https://formulae.brew.sh/api/analytics/install-on-request/30d.json` (static JSON).
Cadence: weekly (use 'daily' cadence, run conditionally). Limit: 50.
Signal: Top rising formulae by install count.

---

### Task 7: Engagement Weighting in Scoring

**Files:**
- Modify: `packages/connectors/src/common/http.ts` — add optional `engagement_count?: number` to `RawEventInput`
- Modify: `apps/api/src/jobs/score.ts` — accept `engagementCount` in `ScoreSignalInput`, apply engagement boost
- Modify: connectors that have engagement data (devto, lobsters, mastodon, bluesky) — populate `engagement_count`

**Engagement boost logic:**
- < 10: no boost
- 10-50: +5 demand
- 50-200: +10 demand, +5 virality
- 200+: +15 demand, +10 virality

---

### Task 8: Multi-Source Convergence Boost

**Files:**
- Modify: `apps/api/src/runtime/postgres_memory_store.ts` — add `findConvergentSignals(signalId, embedding, timeWindowHours)` method
- Modify: `apps/api/src/runtime/live_read_model.ts` — after indexing a signal, check for convergence and boost virality

**Logic:** After indexing a new signal with embedding, query for signals from DIFFERENT sources with cosine distance < 0.35 and observed_at within 48 hours. If found, boost virality by +15 on both the new and matched signals.

---

### Task 9: Integration Test + Final Verification

- Run full test suite: `CI=1 pnpm test`
- Restart API, verify all 15 connectors show in `/health/connectors`
- Check signals from new sources appear in `/feed`
- Verify convergence boosts in signal scores
- Create PR

---
