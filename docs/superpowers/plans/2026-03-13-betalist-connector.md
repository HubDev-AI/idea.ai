# BetaList Connector Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add BetaList as a daily connector that fetches pre-launch startup listings with name, description, and topics via two-phase HTML scraping.

**Architecture:** Phase 1 scrapes the BetaList home page for startup slugs; Phase 2 fetches each startup page in batches of 5 to extract description and topics. The connector follows the same injected-loader pattern as `indiehackers.ts` for testability.

**Tech Stack:** TypeScript, Vitest, `withRetry` from `packages/connectors/src/common/http.ts`, plain `fetch` (no new dependencies)

---

## Chunk 1: Tests + Connector Implementation

### Task 1: Write Failing Tests

**Files:**
- Create: `packages/connectors/tests/betalist.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// packages/connectors/tests/betalist.test.ts
import { describe, expect, it } from 'vitest';
import { fetchBetaList } from '../src/betalist';

// ─── Sample HTML fixtures ────────────────────────────────────────────────────

const MAIN_PAGE_HTML = `
<html><body>
  <a href="/startups/scalify-ai">Scalify AI</a>
  <a href="/startups/devflow-pro">DevFlow Pro</a>
  <a href="/startups/mindmap-ai">MindMap AI</a>
  <a href="/startups/scalify-ai">Duplicate link</a>
  <a href="/topics/ai-tools">AI Tools topic nav link</a>
</body></html>
`;

const STARTUP_PAGE_HTML = `
<html>
<head><title>Scalify AI - BetaList</title></head>
<body>
  <h1>Scalify AI</h1>
  <p>Short.</p>
  <p>Order your own professional website in under 10 minutes using our AI-powered builder. No coding required and fully customizable for any business type.</p>
  <a href="/topics/ai-tools">AI Tools</a>
  <a href="/topics/saas">SaaS</a>
  <time datetime="2026-03-10T00:00:00.000Z">March 10, 2026</time>
</body>
</html>
`;

const STARTUP_PAGE_NO_TOPICS_HTML = `
<html><body>
  <h1>My Startup</h1>
  <p>A really great product that solves a genuinely important problem for people working in software teams everywhere.</p>
  <time datetime="2026-03-10T00:00:00.000Z">March 10</time>
</body></html>
`;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('betalist connector', () => {
  it('returns events with correct source and id prefix', async () => {
    const events = await fetchBetaList({
      loadMainPage: async () => MAIN_PAGE_HTML,
      loadPage: async () => STARTUP_PAGE_HTML,
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.source).toBe('betalist');
    expect(events[0]!.source_item_id).toMatch(/^bl:/);
    expect(events[0]!.url).toMatch(/betalist\.com\/startups\//);
  });

  it('parses name, description, topics, and date from startup page', async () => {
    const events = await fetchBetaList({
      loadMainPage: async () => '<a href="/startups/scalify-ai">x</a>',
      loadPage: async () => STARTUP_PAGE_HTML,
    });

    const event = events[0]!;
    expect(event.text).toContain('Scalify AI');
    expect(event.text).toContain('AI-powered builder');
    expect(event.text).toContain('Topics: ai tools, saas');
    expect(event.source_timestamp).toBe('2026-03-10T00:00:00.000Z');
    expect(event.source_item_id).toBe('bl:scalify-ai');
  });

  it('deduplicates slugs within a single run', async () => {
    const calls: string[] = [];
    await fetchBetaList({
      loadMainPage: async () => MAIN_PAGE_HTML, // contains scalify-ai twice
      loadPage: async (slug) => {
        calls.push(slug);
        return STARTUP_PAGE_HTML;
      },
    });

    expect(calls.filter((s) => s === 'scalify-ai')).toHaveLength(1);
  });

  it('returns [] when main page has no startup links', async () => {
    const events = await fetchBetaList({
      loadMainPage: async () => '<html><body><p>Nothing here</p></body></html>',
      loadPage: async () => STARTUP_PAGE_HTML,
    });

    expect(events).toEqual([]);
  });

  it('returns partial results when some individual page fetches fail', async () => {
    const slugs = ['slug-a', 'slug-b', 'slug-c', 'slug-d', 'slug-e'];
    const mainHtml = slugs.map((s) => `<a href="/startups/${s}">${s}</a>`).join('\n');

    const events = await fetchBetaList({
      loadMainPage: async () => mainHtml,
      loadPage: async (slug) => {
        if (slug === 'slug-b' || slug === 'slug-d') throw new Error('network error');
        return STARTUP_PAGE_HTML;
      },
    });

    expect(events).toHaveLength(3); // slug-a, slug-c, slug-e succeed
  });

  it('omits Topics line when no topics are found on the page', async () => {
    const events = await fetchBetaList({
      loadMainPage: async () => '<a href="/startups/my-startup">My Startup</a>',
      loadPage: async () => STARTUP_PAGE_NO_TOPICS_HTML,
    });

    expect(events[0]!.text).not.toContain('Topics:');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail (import not found)**

```bash
CI=1 pnpm --dir packages/connectors exec vitest run tests/betalist.test.ts
```

Expected: `Error: Cannot find module '../src/betalist'`

- [ ] **Step 3: Commit the failing tests**

```bash
git add packages/connectors/tests/betalist.test.ts
git -c commit.gpgsign=false commit -m "test(betalist): add failing tests for BetaList connector"
```

---

### Task 2: Update `common/http.ts` — Add BetaList to Limits and Cadence

**Files:**
- Modify: `packages/connectors/src/common/http.ts:12-35` (OPEN_CONNECTOR_LIMITS)
- Modify: `packages/connectors/src/common/http.ts:37-60` (OPEN_CONNECTOR_CADENCE)

The connector references `OPEN_CONNECTOR_LIMITS.betalist`, so this entry must exist before writing the connector file or TypeScript will fail to compile.

- [ ] **Step 1: Add `betalist: 25` to `OPEN_CONNECTOR_LIMITS`**

In `packages/connectors/src/common/http.ts`, insert after `appstore_trending: 30` (which is followed by `indiehackers: 20`):

```typescript
  appstore_trending: 30,
  betalist: 25,       // ← add this line
  indiehackers: 20,
```

Note: `bluesky` is NOT in `OPEN_CONNECTOR_LIMITS` — do not use it as a placement reference. The correct insertion point is between `appstore_trending` and `indiehackers`.

- [ ] **Step 2: Add `betalist: 'daily'` to `OPEN_CONNECTOR_CADENCE`**

In the same file, insert after `appstore_trending: 'daily'`:

```typescript
  appstore_trending: 'daily',
  betalist: 'daily',  // ← add this line
  indiehackers: 'daily',
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
CI=1 pnpm --dir packages/connectors exec tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit the `common/http.ts` changes separately**

```bash
git add packages/connectors/src/common/http.ts
git -c commit.gpgsign=false commit -m "feat(betalist): add betalist to connector limits and cadence"
```

---

### Task 3: Implement the BetaList Connector

**Files:**
- Create: `packages/connectors/src/betalist.ts`

- [ ] **Step 1: Create the connector file**

```typescript
// packages/connectors/src/betalist.ts
import { OPEN_CONNECTOR_LIMITS, type RawEventInput, withRetry } from './common/http';

// ─── Types ────────────────────────────────────────────────────────────────────

type MainPageLoaderFn = () => Promise<string>;
type PageLoaderFn = (slug: string) => Promise<string>;

export type BetaListDeps = {
  loadMainPage?: MainPageLoaderFn;
  loadPage?: PageLoaderFn;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const decodeEntities = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');

// Declared inside function to avoid module-level stateful regex with g flag
const extractSlugs = (html: string, limit: number): string[] => {
  const pattern = /href="\/startups\/([a-z0-9-]+)"/g;
  const seen = new Set<string>();
  const slugs: string[] = [];
  let match = pattern.exec(html);
  while (match !== null && slugs.length < limit) {
    const slug = match[1] ?? '';
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      slugs.push(slug);
    }
    match = pattern.exec(html);
  }
  return slugs;
};

const parseName = (html: string): string => {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  return decodeEntities((match?.[1] ?? '').replace(/<[^>]*>/g, '').trim());
};

const parseDescription = (html: string): string => {
  const paragraphs: string[] = [];
  const pattern = /<p[^>]*>([\s\S]*?)<\/p>/g;
  let match = pattern.exec(html);
  while (match !== null) {
    const text = decodeEntities((match[1] ?? '').replace(/<[^>]*>/g, '').trim());
    if (text.length >= 50) {
      paragraphs.push(text);
    }
    match = pattern.exec(html);
  }
  // Pick longest qualifying paragraph (toSorted is ES2023/Node 20+, project already targets Node 20)
  return paragraphs.toSorted((a, b) => b.length - a.length)[0] ?? '';
};

const parseTopics = (html: string): string[] => {
  const seen = new Set<string>();
  const topics: string[] = [];
  const pattern = /href="\/topics\/([a-z0-9-]+)"/g;
  let match = pattern.exec(html);
  while (match !== null) {
    const slug = match[1] ?? '';
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      topics.push(slug.replace(/-/g, ' ')); // "ai-tools" → "ai tools"
    }
    match = pattern.exec(html);
  }
  return topics;
};

const parseDate = (html: string): string => {
  const match = html.match(/<time[^>]+datetime="([^"]+)"/);
  if (match?.[1]) {
    const parsed = new Date(match[1]);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
};

const buildText = (name: string, description: string, topics: string[]): string => {
  const base = description ? `${name}: ${description}` : name;
  // Explicit conditional avoids filter(Boolean) TypeScript narrowing issues
  const parts = topics.length > 0 ? [base, `Topics: ${topics.join(', ')}`] : [base];
  return parts.join('\n').slice(0, 2000);
};

const chunk = <T>(arr: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
};

// ─── Default loaders (real HTTP) ─────────────────────────────────────────────

const defaultMainPageLoader: MainPageLoaderFn = () =>
  withRetry(async () => {
    const res = await fetch('https://betalist.com/', {
      headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' },
    });
    if (!res.ok) throw new Error(`BetaList main page failed: ${res.status}`);
    return res.text();
  });

const defaultPageLoader: PageLoaderFn = (slug) =>
  withRetry(async () => {
    const res = await fetch(`https://betalist.com/startups/${slug}`, {
      headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' },
    });
    if (!res.ok) throw new Error(`BetaList startup page failed (${slug}): ${res.status}`);
    return res.text();
  });

// ─── Public export ────────────────────────────────────────────────────────────

export const fetchBetaList = async (
  deps: BetaListDeps = {},
  limit: number = OPEN_CONNECTOR_LIMITS.betalist,
): Promise<RawEventInput[]> => {
  const loadMainPage = deps.loadMainPage ?? defaultMainPageLoader;
  const loadPage = deps.loadPage ?? defaultPageLoader;

  let mainHtml: string;
  try {
    mainHtml = await loadMainPage();
  } catch {
    return [];
  }

  const slugs = extractSlugs(mainHtml, limit);
  if (slugs.length === 0) return [];

  const results: RawEventInput[] = [];

  for (const batch of chunk(slugs, 5)) {
    await Promise.allSettled(
      batch.map(async (slug) => {
        try {
          // withRetry at call site ensures retry behaviour for any loadPage impl,
          // including injected loaders in tests and the default HTTP loader.
          const html = await withRetry(() => loadPage(slug));
          const name = parseName(html);
          if (!name) return;
          results.push({
            source: 'betalist',
            source_item_id: `bl:${slug}`,
            source_timestamp: parseDate(html),
            text: buildText(name, parseDescription(html), parseTopics(html)),
            url: `https://betalist.com/startups/${slug}`,
          });
        } catch {
          // Skip failed slug — remaining batch continues
        }
      }),
    );
  }

  return results.slice(0, limit);
};
```

- [ ] **Step 2: Run the BetaList tests**

```bash
CI=1 pnpm --dir packages/connectors exec vitest run tests/betalist.test.ts
```

Expected: all 6 tests PASS

- [ ] **Step 3: Run full connector test suite to check for regressions**

```bash
CI=1 pnpm --dir packages/connectors exec vitest run
```

Expected: all existing tests still pass

- [ ] **Step 4: Commit connector implementation**

```bash
git add packages/connectors/src/betalist.ts
git -c commit.gpgsign=false commit -m "feat(betalist): implement BetaList connector with two-phase HTML scraping"
```

---

## Chunk 2: Registration + Verification

### Task 4: Register BetaList in All Required Files

**Files:**
- Modify: `apps/api/src/jobs/ingest_open.ts` (import, union, loaders, order)
- Modify: `apps/api/src/runtime/live_read_model.ts:49` (OPEN_CONNECTORS array)
- Modify: `apps/api/src/config/env.ts:74` (dailyConnectors default)
- Modify: `apps/web/src/connectorNames.ts` (display name map)

- [ ] **Step 1: Update `ingest_open.ts` — import**

The current file starts with `import { fetchAlternativeTo } from '@idea/connectors/src/alternativeto'` on line 1, followed by `import { fetchAppStoreTrending }` on line 2. Add the BetaList import at line 2 (between alternativeto and appstore, alphabetical order):

```typescript
import { fetchAlternativeTo } from '@idea/connectors/src/alternativeto';
import { fetchBetaList } from '@idea/connectors/src/betalist';      // ← add at line 2
import { fetchAppStoreTrending } from '@idea/connectors/src/appstore';
```

- [ ] **Step 2: Update `ingest_open.ts` — union, CONNECTOR_ORDER, defaultLoaders**

Extend `OpenConnectorName` union — add `'betalist'` after `'appstore_trending'`:

```typescript
export type OpenConnectorName = 'hn' | 'github_issues' | 'greenhouse' | 'lever' | 'yc_companies' | 'reddit' | 'producthunt' | 'appstore_trending' | 'betalist' | 'indiehackers' | 'lobsters' | 'devto' | 'showhn' | 'mastodon' | 'bluesky' | 'homebrew' | 'google_trends' | 'tiktok_creative' | 'alternativeto' | 'stackoverflow' | 'g2_reviews' | 'npm_trends' | 'semantic_scholar';
```

Add to `CONNECTOR_ORDER` after `'appstore_trending'`:

```typescript
const CONNECTOR_ORDER: OpenConnectorName[] = ['hn', 'github_issues', 'greenhouse', 'lever', 'yc_companies', 'reddit', 'producthunt', 'appstore_trending', 'betalist', 'indiehackers', 'lobsters', 'devto', 'showhn', 'mastodon', 'bluesky', 'homebrew', 'google_trends', 'tiktok_creative', 'alternativeto', 'stackoverflow', 'g2_reviews', 'npm_trends', 'semantic_scholar'];
```

Add to `defaultLoaders` after `appstore_trending`:

```typescript
  appstore_trending: () => fetchAppStoreTrending(),
  betalist: () => fetchBetaList(),
  indiehackers: () => fetchIndieHackersEvents(),
```

- [ ] **Step 3: Update `live_read_model.ts` — OPEN_CONNECTORS array (line 49)**

Add `'betalist'` after `'appstore_trending'`:

```typescript
const OPEN_CONNECTORS: OpenConnectorName[] = ['hn', 'github_issues', 'greenhouse', 'lever', 'yc_companies', 'reddit', 'producthunt', 'appstore_trending', 'betalist', 'indiehackers', 'lobsters', 'devto', 'showhn', 'mastodon', 'bluesky', 'homebrew', 'google_trends', 'tiktok_creative', 'alternativeto', 'stackoverflow', 'g2_reviews', 'npm_trends', 'semantic_scholar'];
```

- [ ] **Step 4: Update `env.ts` — dailyConnectors default (line 74)**

Add `'betalist'` alongside `producthunt` and `indiehackers`:

```typescript
    dailyConnectors: parseCsv(env.DAILY_CONNECTORS, ['greenhouse', 'lever', 'yc_companies', 'producthunt', 'appstore_trending', 'betalist', 'indiehackers', 'google_trends']),
```

- [ ] **Step 5: Update `connectorNames.ts` — display name**

Add `betalist: 'BetaList'` after `appstore_trending`:

```typescript
  appstore_trending: 'App Store',
  betalist: 'BetaList',
  indiehackers: 'IndieHackers',
```

- [ ] **Step 6: Build the API package to catch TypeScript errors**

```bash
CI=1 pnpm --dir apps/api exec tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Run the full test suite**

```bash
CI=1 pnpm test
```

Expected: all tests pass (existing count + 6 new BetaList tests)

- [ ] **Step 8: Commit registration changes**

```bash
git add apps/api/src/jobs/ingest_open.ts \
        apps/api/src/runtime/live_read_model.ts \
        apps/api/src/config/env.ts \
        apps/web/src/connectorNames.ts
git -c commit.gpgsign=false commit -m "feat(betalist): register BetaList connector in pipeline and UI"
```

---

## Final Verification

- [ ] Confirm all 4 commits are on the `dev` branch (tests, http.ts, connector, registration)
- [ ] Confirm `CI=1 pnpm test` passes clean with the new 6 BetaList tests included
- [ ] Invoke `superpowers:finishing-a-development-branch` to create the PR
