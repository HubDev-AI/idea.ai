# Audit Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close all 9 audit issues (3 P1, 6 P2) and 5 refactoring candidates in a single PR against `dev`.

**Architecture:** Group 1 secures the transport layer (auth, origins, env); Groups 2–4 fix backend and UI correctness; Group 5 removes duplication without changing behavior. Run `CI=1 pnpm test` after every commit to verify nothing breaks.

**Tech Stack:** Fastify 5, Socket.IO, React 18, Vitest, PostgreSQL, TypeScript

---

## Group 1 — Auth Layer

### Task 1: Add `VITE_API_KEY` to env files and forward it in HTTP requests

**Files:**
- Modify: `.env.example`
- Modify: `.env` (root — contains all VITE_ vars)
- Modify: `apps/web/src/api.ts`

**Step 1: Add `VITE_API_KEY` to env example and real env**

In `.env.example`, after `VITE_API_PROXY_TARGET=...`, add:
```
# Auth — must match API_KEY in apps/api section when set
VITE_API_KEY=
```

In `.env`, add the same line (empty value, matching unauthenticated local dev):
```
VITE_API_KEY=
```

**Step 2: Add `getApiKey` helper and `apiFetch` wrapper in api.ts**

After the `API_BASE_URL` constant (line 44), add:

```typescript
const getApiKey = (): string =>
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_API_KEY ?? '';

export const apiFetch = (path: string, init: RequestInit = {}): Promise<Response> => {
  const key = getApiKey();
  const headers = new Headers(init.headers);
  if (key) headers.set('x-api-key', key);
  return fetch(buildApiUrl(path), { ...init, headers });
};
```

**Step 3: Replace `fetch(buildApiUrl(...))` with `apiFetch(...)` throughout api.ts**

Every call in `api.ts` of the form `fetch(buildApiUrl('/v1/...'), ...)` becomes `apiFetch('/v1/...', ...)`.

Example before:
```typescript
const res = await fetch(buildApiUrl(`/v1/signals?${params.toString()}`));
```
After:
```typescript
const res = await apiFetch(`/v1/signals?${params.toString()}`);
```

Do this for all 15 fetch calls in the file. `buildApiUrl` can stay for any URL construction that isn't a direct fetch.

**Step 4: Run tests**

```bash
CI=1 pnpm --dir apps/web test
```
Expected: all pass (no behavior change, just header injection).

**Step 5: Commit**

```bash
git add .env.example .env apps/web/src/api.ts
git -c commit.gpgsign=false commit -m "fix: add VITE_API_KEY env and forward x-api-key in web HTTP client"
```

---

### Task 2: Socket.IO handshake auth (server)

**Files:**
- Modify: `apps/api/src/ws/state_hub.ts`
- Test: `apps/api/tests/state-hub-auth.test.ts` (new)

**Step 1: Write the failing test**

Create `apps/api/tests/state-hub-auth.test.ts`:

```typescript
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioc } from 'socket.io-client';
import { StateHub } from '../src/ws/state_hub';
import type { StateHubDeps, StateHubConfig } from '../src/ws/state_hub';

const makeStubDeps = (): StateHubDeps => ({
  getConnectors: async () => [],
  getAiHealth: async () => ({ providers: [], refreshed_at: null }),
  getAgentStatus: () => ({ isRunning: false, intervalMs: 0, lastRun: null, investigateNext: null }),
  getInfraStatus: async () => ({ postgres: 'ok', ollama: 'ok', embeddings: { total: 0, withEmbedding: 0, fallbackModel: 'none' } }),
  getRefreshMeta: () => ({ last_hourly_run: null, last_daily_run: null, hourly_interval_ms: 3600000, daily_interval_ms: 86400000, refreshing: null }),
  getSignalCounts: async () => ({}),
  getSignalCount: async () => 0,
  getLatestSignalAt: async () => null,
  getThesisStats: async () => ({ total: 0, promoted: 0, watching: 0, totalEvidence: 0, totalSources: 0 }),
  getLogs: async () => [],
});

const cfg: StateHubConfig = { infraPollMs: 999999, logPollMs: 999999 };

describe('StateHub auth', () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: SocketIOServer;
  let port: number;

  beforeEach(async () => {
    httpServer = createServer();
    io = new SocketIOServer(httpServer, { cors: { origin: '*' } });
    await new Promise<void>((r) => httpServer.listen(0, () => r()));
    port = (httpServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    io.close();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  it('rejects socket connection when apiKey set and no key provided', async () => {
    new StateHub(io, makeStubDeps(), cfg, 'secret-key');

    const socket = ioc(`http://localhost:${port}`, { reconnection: false });
    const error = await new Promise<string>((resolve) => {
      socket.on('connect_error', (err) => resolve(err.message));
      socket.on('connect', () => resolve('connected'));
    });
    socket.disconnect();
    expect(error).toBe('Unauthorized');
  });

  it('accepts socket connection when apiKey set and correct key provided', async () => {
    new StateHub(io, makeStubDeps(), cfg, 'secret-key');

    const socket = ioc(`http://localhost:${port}`, {
      auth: { key: 'secret-key' },
      reconnection: false,
    });
    const result = await new Promise<string>((resolve) => {
      socket.on('connect', () => resolve('connected'));
      socket.on('connect_error', (err) => resolve(err.message));
    });
    socket.disconnect();
    expect(result).toBe('connected');
  });

  it('accepts socket connection when no apiKey set (open dev mode)', async () => {
    new StateHub(io, makeStubDeps(), cfg, undefined);

    const socket = ioc(`http://localhost:${port}`, { reconnection: false });
    const result = await new Promise<string>((resolve) => {
      socket.on('connect', () => resolve('connected'));
      socket.on('connect_error', (err) => resolve(err.message));
    });
    socket.disconnect();
    expect(result).toBe('connected');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
CI=1 pnpm --dir apps/api test state-hub-auth
```
Expected: FAIL — `StateHub` constructor doesn't accept an `apiKey` argument.

**Step 3: Update `StateHub` to accept `apiKey` and install middleware**

In `state_hub.ts`, change the constructor signature and add auth middleware:

```typescript
constructor(io: IO, deps: StateHubDeps, config: StateHubConfig, apiKey?: string) {
  this.io = io;
  this.deps = deps;
  this.config = config;
  // ... existing state init ...

  if (apiKey) {
    io.use((socket, next) => {
      const provided = (socket.handshake.auth as Record<string, unknown>).key;
      if (provided !== apiKey) {
        next(new Error('Unauthorized'));
      } else {
        next();
      }
    });
  }

  io.on('connection', (socket) => {
    socket.emit('snapshot', this.state);
  });
}
```

**Step 4: Pass `apiKey` to `StateHub` in `main.ts`**

Find the `new StateHub(io, { ... }, { ... })` call (around line 374) and add `apiKey` as the 4th argument:

```typescript
const stateHub = new StateHub(io, { ... }, { infraPollMs: ..., logPollMs: ... }, apiKey);
```

**Step 5: Run tests**

```bash
CI=1 pnpm --dir apps/api test state-hub-auth
```
Expected: all 3 PASS.

**Step 6: Commit**

```bash
git add apps/api/src/ws/state_hub.ts apps/api/src/main.ts apps/api/tests/state-hub-auth.test.ts
git -c commit.gpgsign=false commit -m "fix(P1): add Socket.IO handshake auth — rejects unauthenticated connections when API_KEY set"
```

---

### Task 3: Add auth to Socket.IO client + lock down origins + startup enforcement

**Files:**
- Modify: `apps/web/src/useSocket.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `.env.example`
- Modify: `.env`

**Step 1: Forward `VITE_API_KEY` in Socket.IO handshake**

In `useSocket.ts`, change the `io()` call from:
```typescript
const socket: TypedSocket = io({
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
});
```
To:
```typescript
const apiKey =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_API_KEY ?? '';

const socket: TypedSocket = io({
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  ...(apiKey ? { auth: { key: apiKey } } : {}),
});
```

**Step 2: Restrict Socket.IO CORS origins in `main.ts`**

Find the `SocketIOServer` instantiation (around line 365):
```typescript
const io = new SocketIOServer(app.server, {
  cors: {
    origin: corsOrigins.length > 0 ? corsOrigins : '*',  // <-- remove wildcard
    methods: ['GET', 'POST'],
  },
  path: '/socket.io/',
});
```
Replace with:
```typescript
const allowedOrigins = corsOrigins.length > 0
  ? corsOrigins
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

const io = new SocketIOServer(app.server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
  path: '/socket.io/',
});
```

**Step 3: Enforce startup auth check in `main.ts`**

After `const apiKey = process.env.API_KEY || undefined;` (around line 41), add:
```typescript
if (!apiKey && host !== '127.0.0.1' && host !== 'localhost') {
  console.error(
    `[startup] ERROR: API_KEY is not set but HOST=${host} is not localhost. ` +
    `Set API_KEY or bind to 127.0.0.1 for local-only mode.`
  );
  process.exit(1);
}
```

**Step 4: Update `.env.example` security section**

Replace:
```
# Security (optional — omit for open dev mode)
# API_KEY=
# CORS_ORIGINS=http://localhost:5173
# RATE_LIMIT_MAX=100
```
With:
```
# Security
# API_KEY is required when HOST != 127.0.0.1 (any non-localhost deployment)
# API_KEY=
# ALLOWED_ORIGINS defaults to localhost:5173 — override for production
# CORS_ORIGINS=http://localhost:5173
# RATE_LIMIT_MAX=100
```

**Step 5: Run full test suite**

```bash
CI=1 pnpm test
```
Expected: all pass. (The startup exit path only fires at runtime, not in test.)

**Step 6: Commit**

```bash
git add apps/web/src/useSocket.ts apps/api/src/main.ts .env.example .env
git -c commit.gpgsign=false commit -m "fix(P1,P2-4): WS client forwards api key; lock down CORS origins; enforce auth on non-localhost"
```

---

### Task 4: Strip prompt/output previews from WebSocket wire data

**Files:**
- Modify: `apps/api/src/jobs/agent_runner.ts` (lines 304–307 and 514–518)
- Modify: `apps/api/src/jobs/deep_dive_generator.ts` (lines 87–90)
- Modify: `apps/api/src/jobs/ai_post_scrape.ts` (lines 220–227)

**Step 1: Inspect the four preview log sites**

Read each file at the flagged line ranges to understand exactly what field carries the preview. The common pattern is a `debug` log with a `prompt_preview` or `output_preview` field in the context object.

**Step 2: Remove preview fields from debug log context**

For each site, remove only the `prompt_preview` / `output_preview` key from the context object. Leave all other log fields (component, message, duration, token counts, etc.) intact.

Example — before:
```typescript
await log.debug('agent_runner', 'broad scan prompt sent', {
  provider: preferred,
  prompt_length: broadPrompt.length,
  prompt_preview: broadPrompt.slice(0, 300),  // <-- remove this
});
```
After:
```typescript
await log.debug('agent_runner', 'broad scan prompt sent', {
  provider: preferred,
  prompt_length: broadPrompt.length,
});
```

Apply the same change to all 4 sites (2 in agent_runner.ts, 1 in deep_dive_generator.ts, 1 in ai_post_scrape.ts).

**Step 3: Run tests**

```bash
CI=1 pnpm test
```
Expected: all pass.

**Step 4: Commit**

```bash
git add apps/api/src/jobs/agent_runner.ts apps/api/src/jobs/deep_dive_generator.ts apps/api/src/jobs/ai_post_scrape.ts
git -c commit.gpgsign=false commit -m "fix(P1): remove raw prompt/output previews from WebSocket log wire data"
```

---

## Group 2 — URL Safety

### Task 5: Sanitize `source_url` on ingest and at render

**Files:**
- Modify: `apps/api/src/runtime/postgres_signal_store.ts`
- Modify: `apps/web/src/components/SignalRow.tsx`
- Test: `apps/api/tests/url-sanitize.test.ts` (new)
- Test: `apps/web/tests/signal-row.test.tsx` (existing — extend)

**Step 1: Write the unit test for `sanitizeUrl`**

Create `apps/api/tests/url-sanitize.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { sanitizeUrl } from '../src/runtime/postgres_signal_store';

describe('sanitizeUrl', () => {
  it('passes through https URLs unchanged', () => {
    expect(sanitizeUrl('https://example.com/page')).toBe('https://example.com/page');
  });

  it('passes through http URLs unchanged', () => {
    expect(sanitizeUrl('http://example.com/page')).toBe('http://example.com/page');
  });

  it('returns null for javascript: URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('returns null for data: URLs', () => {
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(sanitizeUrl(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(sanitizeUrl(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(sanitizeUrl('')).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
CI=1 pnpm --dir apps/api test url-sanitize
```
Expected: FAIL — `sanitizeUrl` not exported.

**Step 3: Add `sanitizeUrl` to `postgres_signal_store.ts` and apply it**

At the top of `postgres_signal_store.ts` (after imports, before any function), add:

```typescript
export const sanitizeUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
};
```

Then find the INSERT at lines 77–122 where `source_url` is set. Change:
```typescript
entry.memoryRecord.source_url ?? null
```
To:
```typescript
sanitizeUrl(entry.memoryRecord.source_url)
```

**Step 4: Run API test**

```bash
CI=1 pnpm --dir apps/api test url-sanitize
```
Expected: all PASS.

**Step 5: Add render-time guard in `SignalRow.tsx`**

After the existing imports in `SignalRow.tsx`, add a helper:

```typescript
const safeHref = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
};
```

Then replace both occurrences of `signal.source_url` in `href`:
- Line 22: `href={signal.source_url}` → `href={safeHref(signal.source_url) ?? '#'}`
  But to avoid rendering a dead link, conditionally render:
  ```tsx
  {safeHref(signal.source_url) ? (
    <a className="signal-idea signal-idea-link" href={safeHref(signal.source_url)!} target="_blank" rel="noreferrer">
      {signal.idea.split('|')[0].trim()}
    </a>
  ) : (
    <h3 className="signal-idea">{signal.idea.split('|')[0].trim()}</h3>
  )}
  ```
  And for the Source link at line 47–51:
  ```tsx
  {safeHref(signal.source_url) ? (
    <a className="source-link" href={safeHref(signal.source_url)!} target="_blank" rel="noreferrer">
      Source
    </a>
  ) : null}
  ```

**Step 6: Extend signal-row test to cover the render guard**

Open `apps/web/tests/signal-row.test.tsx` and add a test case for a `javascript:` URL:

```typescript
it('renders idea as plain text when source_url has javascript: scheme', () => {
  const signal = makeSignal({ source_url: 'javascript:alert(1)' });
  const { queryByRole } = render(<SignalRow signal={signal} />);
  expect(queryByRole('link')).toBeNull();
});
```

Where `makeSignal` is a helper already in the file (or add it):
```typescript
const makeSignal = (overrides = {}) => ({
  idea: 'Test idea',
  score: 80,
  top_source: 'hn',
  snippet: 'test snippet',
  source_url: 'https://example.com',
  next_action: 'validate_demand',
  updated_at: new Date().toISOString(),
  ...overrides,
});
```

**Step 7: Run all web tests**

```bash
CI=1 pnpm --dir apps/web test
```
Expected: all PASS.

**Step 8: Commit**

```bash
git add apps/api/src/runtime/postgres_signal_store.ts apps/api/tests/url-sanitize.test.ts apps/web/src/components/SignalRow.tsx apps/web/tests/signal-row.test.tsx
git -c commit.gpgsign=false commit -m "fix(P1): sanitize source_url on ingest and before render — block non-http(s) schemes"
```

---

## Group 3 — Backend Logic

### Task 6: Export `startRefresh` only from live_read_model; update callers

**Files:**
- Modify: `apps/api/src/runtime/live_read_model.ts`
- Modify: `apps/api/src/main.ts`
- Test: `apps/api/tests/live-read-model-resilience.test.ts` (existing — extend)

**Step 1: Look at the existing `startRefresh` signature**

Read `live_read_model.ts:956-964`:
```typescript
const startRefresh = (): Promise<Snapshot> => {
  if (!refreshInFlight) {
    refreshInFlight = refresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
};
```

**Step 2: Update `startRefresh` to accept an optional `cadence` parameter**

Change:
```typescript
const startRefresh = (): Promise<Snapshot> => {
  if (!refreshInFlight) {
    refreshInFlight = refresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
};
```
To:
```typescript
const startRefresh = (cadence?: 'hourly' | 'daily'): Promise<Snapshot> => {
  if (!refreshInFlight) {
    refreshInFlight = refresh(cadence).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
};
```

**Step 3: Replace `refresh` with `startRefresh` in the return object at line 1033**

Find:
```typescript
    refresh,
    close: async (): Promise<void> => {
```
Replace with:
```typescript
    startRefresh,
    close: async (): Promise<void> => {
```

**Step 4: Update `main.ts` to call `readModel.startRefresh`**

Find `triggerRefresh` wiring at lines 259–285:
```typescript
triggerRefresh: async (cadence) => {
    stateHub.pushRefreshMeta();
    await readModel.refresh(cadence);   // <-- change this
    void stateHub.broadcastAll();
    ...
```
Change to:
```typescript
triggerRefresh: async (cadence) => {
    stateHub.pushRefreshMeta();
    await readModel.startRefresh(cadence);
    void stateHub.broadcastAll();
    ...
```

**Step 5: Check if `readModel.refresh` is referenced anywhere else**

```bash
grep -rn "readModel\.refresh" apps/api/src/
```
Fix any remaining references to use `readModel.startRefresh`.

**Step 6: Add a test for concurrent refresh guard**

In `apps/api/tests/live-read-model-resilience.test.ts`, add:

```typescript
it('deduplicates concurrent startRefresh calls — only one refresh runs', async () => {
  let refreshCallCount = 0;
  // ... set up a read model with a refresh tracker
  // Call startRefresh() twice concurrently and verify refreshCallCount === 1
});
```

Read the existing test file first to understand the test setup pattern used there, then mirror it.

**Step 7: Run tests**

```bash
CI=1 pnpm --dir apps/api test live-read-model-resilience
```
Expected: all PASS.

**Step 8: Commit**

```bash
git add apps/api/src/runtime/live_read_model.ts apps/api/src/main.ts apps/api/tests/live-read-model-resilience.test.ts
git -c commit.gpgsign=false commit -m "fix(P2-5): expose startRefresh only — concurrent manual refresh calls now guarded"
```

---

### Task 7: Deep-dive per-thesis in-flight promise dedup

**Files:**
- Modify: `apps/api/src/routes/theses.ts`
- Test: `apps/api/tests/theses-deep-dive-dedup.test.ts` (new)

**Step 1: Write the failing test**

Create `apps/api/tests/theses-deep-dive-dedup.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server';

describe('deep-dive dedup', () => {
  it('concurrent POST /v1/theses/:key/deep-dive only calls AI once', async () => {
    let generateCallCount = 0;

    const server = await buildServer({
      listSignals: async () => [],
      listConnectors: async () => [],
      thesisStore: {
        getByKey: async () => ({
          canonicalKey: 'test:idea',
          title: 'Test Idea',
          problemStatement: 'pain',
          targetBuyer: 'devs',
          proposedSolution: 'solution',
          confidence: 60,
          topic: 'test',
          status: 'watching',
          evidenceCount: 1,
          evidence: [],
        }),
      } as never,
      deepDiveStore: {
        getByKey: async () => null,
        save: async (_key: string, data: unknown) => ({ canonical_key: _key, ...data as object, created_at: new Date().toISOString() }),
      } as never,
      deepDiveAi: {
        runClaude: vi.fn(),
        runCodex: vi.fn(),
        preferredProvider: 'claude',
        generateDeepDive: async () => {
          generateCallCount++;
          await new Promise((r) => setTimeout(r, 50)); // simulate latency
          return {
            result: {
              summary: 's',
              howItWorks: 'h',
              growthStrategy: 'g',
              buildSuggestions: [],
            },
            provider: 'claude',
          };
        },
      } as never,
    });

    // Fire 3 concurrent requests for the same thesis
    const [r1, r2, r3] = await Promise.all([
      server.inject({ method: 'POST', url: '/v1/theses/test%3Aidea/deep-dive' }),
      server.inject({ method: 'POST', url: '/v1/theses/test%3Aidea/deep-dive' }),
      server.inject({ method: 'POST', url: '/v1/theses/test%3Aidea/deep-dive' }),
    ]);

    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r3.statusCode).toBe(200);
    expect(generateCallCount).toBe(1); // key assertion

    await server.close();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
CI=1 pnpm --dir apps/api test theses-deep-dive-dedup
```
Expected: FAIL — `generateCallCount` will be 3, not 1.

**Step 3: Add the promise map in `theses.ts`**

At the top of `registerThesisRoute` (or just before the POST handler), add a module-level map:

```typescript
// Module-level — lives for the lifetime of the process
const inFlightDives = new Map<string, Promise<unknown>>();
```

Then inside the POST `/v1/theses/:key/deep-dive` handler, wrap the generation:

```typescript
// Return cached if exists
const cached = await deps.deepDiveStore.getByKey(key);
if (cached) {
  await deps.logger?.info('deep_dive', 'deep-dive served from cache', { thesis: key });
  return cached;
}

// Fetch thesis data
const thesis = await deps.store.getByKey(key);
if (!thesis) {
  reply.code(404);
  return { error: 'Thesis not found' };
}

// Dedup concurrent generation requests for the same key
if (!inFlightDives.has(key)) {
  const work = (async () => {
    await deps.logger?.info('deep_dive', 'deep-dive generation requested', { thesis: key, title: thesis.title });
    const startMs = Date.now();
    try {
      const { result, provider } = await generateDeepDive({
        title: thesis.title,
        problemStatement: thesis.problemStatement,
        targetBuyer: thesis.targetBuyer,
        proposedSolution: thesis.proposedSolution,
        confidence: thesis.confidence,
      }, { ...deps.deepDiveAi, logger: deps.logger });

      const saved = await deps.deepDiveStore.save(key, {
        summary: result.summary,
        howItWorks: result.howItWorks,
        growthStrategy: result.growthStrategy,
        buildSuggestions: result.buildSuggestions,
        generatedBy: provider,
      });

      await deps.logger?.info('deep_dive', 'deep-dive saved', {
        thesis: key, provider, duration_ms: Date.now() - startMs
      });

      return saved;
    } catch (err) {
      await deps.logger?.error('deep_dive', 'deep-dive generation failed', {
        thesis: key,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startMs
      });
      throw err;
    } finally {
      inFlightDives.delete(key);
    }
  })();
  inFlightDives.set(key, work);
}

return inFlightDives.get(key);
```

Remove the old try/catch block that previously held this logic (it's now inside the closure above).

**Step 4: Run test**

```bash
CI=1 pnpm --dir apps/api test theses-deep-dive-dedup
```
Expected: PASS — `generateCallCount === 1`.

**Step 5: Run full suite**

```bash
CI=1 pnpm test
```
Expected: all PASS.

**Step 6: Commit**

```bash
git add apps/api/src/routes/theses.ts apps/api/tests/theses-deep-dive-dedup.test.ts
git -c commit.gpgsign=false commit -m "fix(P2-6): dedup concurrent deep-dive generation — same thesis shares one in-flight promise"
```

---

### Task 8: Apply filter clauses to stats query in `listPaginated`

**Files:**
- Modify: `apps/api/src/runtime/postgres_thesis_store.ts`
- Test: `apps/api/tests/thesis-store-stats.test.ts` (new)

**Step 1: Write the failing test**

Create `apps/api/tests/thesis-store-stats.test.ts`:

```typescript
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresThesisStore } from '../src/runtime/postgres_thesis_store';

// Skip if no DB available
const DB_URL = process.env.DATABASE_URL;
describe.skipIf(!DB_URL)('thesis store — stats filter', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DB_URL! });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('stats total matches filtered count, not global count', async () => {
    const store = createPostgresThesisStore({ pool });

    // List filtered by profile=consumer
    const page = await store.listPaginated({ profile: 'consumer' });

    // The stats.total must equal the filtered item count, not all theses
    expect(page.stats.total).toBe(page.total_items);
  });
});
```

**Step 2: Run test to see it fail (if DB available) or skip**

```bash
DATABASE_URL=postgresql://idea_ai:idea_ai_dev@127.0.0.1:5917/idea_ai CI=1 pnpm --dir apps/api test thesis-store-stats
```
Expected: FAIL — `stats.total` does not match `total_items` when filtered.

**Step 3: Apply the filter to `statsResult` in `postgres_thesis_store.ts`**

Find the `statsResult` query (lines 233–248). It currently runs without a `WHERE` clause. Change it to reuse `where` and `countParams`:

Before:
```typescript
pool.query<{ ... }>(
  `SELECT COUNT(*)::text AS total, ...
   FROM (
     SELECT tc.status, COUNT(...) AS ev_count, COUNT(...) AS src_count
     FROM thesis_candidates tc
     LEFT JOIN thesis_evidence te ON te.thesis_id = tc.id
     LEFT JOIN scored_signals sm ON sm.signal_id = te.signal_id
     GROUP BY tc.id, tc.status
   ) sub`
)
```

After (add `WHERE` inside the subquery):
```typescript
pool.query<{ ... }>(
  `SELECT COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE status = 'promoted')::text AS promoted,
          COUNT(*) FILTER (WHERE status = 'watching')::text AS watching,
          COALESCE(SUM(ev_count), 0)::text AS total_evidence,
          COALESCE(SUM(src_count), 0)::text AS total_sources
   FROM (
     SELECT tc.status,
            COUNT(DISTINCT te.signal_id) AS ev_count,
            COUNT(DISTINCT sm.source) AS src_count
     FROM thesis_candidates tc
     LEFT JOIN thesis_evidence te ON te.thesis_id = tc.id
     LEFT JOIN scored_signals sm ON sm.signal_id = te.signal_id
     ${where}
     GROUP BY tc.id, tc.status
   ) sub`,
  countParams
)
```

Note: `where` and `countParams` are already defined above this query — just reference them.

**Step 4: Run test**

```bash
DATABASE_URL=postgresql://idea_ai:idea_ai_dev@127.0.0.1:5917/idea_ai CI=1 pnpm --dir apps/api test thesis-store-stats
```
Expected: PASS.

**Step 5: Run full suite**

```bash
CI=1 pnpm test
```
Expected: all PASS.

**Step 6: Commit**

```bash
git add apps/api/src/runtime/postgres_thesis_store.ts apps/api/tests/thesis-store-stats.test.ts
git -c commit.gpgsign=false commit -m "fix(P2-7): apply filter clauses to thesis stats query — stats now describe filtered dataset"
```

---

### Task 9: Emit `signalCount` and `latestSignalAt` in live broadcasts

**Files:**
- Modify: `packages/contracts/src/ws.ts`
- Modify: `apps/api/src/ws/state_hub.ts`
- Modify: `apps/web/src/useSocket.ts`

**Step 1: Add the two new events to the contract**

In `packages/contracts/src/ws.ts`, add to `ServerToClientEvents`:

```typescript
export type ServerToClientEvents = {
  snapshot: (state: AppSnapshot) => void;
  connectors: (data: ConnectorStatusRecord[]) => void;
  aiHealth: (data: AiHealthRecord) => void;
  agentStatus: (data: AgentStatusRecord) => void;
  infraStatus: (data: InfraStatusRecord) => void;
  refreshMeta: (data: RefreshMeta) => void;
  signalCounts: (data: Record<string, number>) => void;
  signalCount: (count: number) => void;           // <-- add
  latestSignalAt: (at: string | null) => void;    // <-- add
  thesisStats: (data: ThesisStats) => void;
  logs: (data: ExecutionLogRecord[]) => void;
  signalsUpdated: () => void;
  thesesUpdated: () => void;
};
```

**Step 2: Add emitters and emit in `broadcastAll`**

In `state_hub.ts`, add two new emit methods after `emitSignalCounts`:

```typescript
emitSignalCount(count: number): void {
  this.state.signalCount = count;
  this.io.emit('signalCount', count);
}

emitLatestSignalAt(at: string | null): void {
  this.state.latestSignalAt = at;
  this.io.emit('latestSignalAt', at);
}
```

Then in `broadcastAll`, after the existing emits, add:
```typescript
this.io.emit('signalCount', s.signalCount);
this.io.emit('latestSignalAt', s.latestSignalAt);
```

**Step 3: Handle the new events in `useSocket.ts`**

The state already has `signalCount` and `latestSignalAt` fields with `useState`. Add listeners for the new events in the `useEffect`:

```typescript
socket.on('signalCount', setSignalCount);
socket.on('latestSignalAt', setLatestSignalAt);
```

Place them alongside the existing `socket.on('signalCounts', setSignalCounts)` call.

**Step 4: Run tests**

```bash
CI=1 pnpm test
```
Expected: all PASS. TypeScript should compile without errors since the new events match the updated contract.

**Step 5: Commit**

```bash
git add packages/contracts/src/ws.ts apps/api/src/ws/state_hub.ts apps/web/src/useSocket.ts
git -c commit.gpgsign=false commit -m "fix(P2-8): emit signalCount and latestSignalAt on every broadcast — sidebar stays fresh"
```

---

## Group 4 — UI Fix

### Task 10: Fix nested `<button>` in log drawer

**Files:**
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/tests/app.test.tsx` (existing — extend)

**Step 1: Write the failing test**

Open `apps/web/tests/app.test.tsx` and add (inside the existing describe or at top level):

```typescript
it('log drawer header does not nest a button inside another button', () => {
  const { container } = render(<App />);
  const toggles = container.querySelectorAll('.log-drawer-toggle');
  for (const toggle of toggles) {
    const nestedButtons = toggle.querySelectorAll('button');
    expect(nestedButtons.length).toBe(0);
  }
});
```

**Step 2: Run test to verify it fails**

```bash
CI=1 pnpm --dir apps/web test app
```
Expected: FAIL — there is a `<button>` inside `.log-drawer-toggle`.

**Step 3: Restructure the log drawer header in `App.tsx`**

Find the log drawer section (around line 751). Currently:
```tsx
<button
  type="button"
  className="log-drawer-toggle"
  onClick={() => setLogDrawerOpen((v) => !v)}
>
  <span className="log-drawer-title">...</span>
  <span className="log-drawer-right">
    {logDrawerOpen && (
      <button   {/* <-- nested, invalid */}
        type="button"
        className="log-action-btn"
        ...
      >Copy</button>
    )}
    <span className="log-drawer-chevron">...</span>
  </span>
</button>
```

Replace with (keep the same visual layout, just restructure):
```tsx
<div
  className="log-drawer-toggle"
  role="button"
  tabIndex={0}
  aria-expanded={logDrawerOpen}
  onClick={() => setLogDrawerOpen((v) => !v)}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setLogDrawerOpen((v) => !v);
    }
  }}
>
  <span className="log-drawer-title">
    Logs
    <span className="log-drawer-count">{ws.logs.length}</span>
    <span className={`log-drawer-status ${ws.connected ? 'live' : ''}`}>
      {ws.connected ? 'LIVE' : 'DISCONNECTED'}
    </span>
  </span>
  <span className="log-drawer-right">
    {logDrawerOpen && (
      <button
        type="button"
        className="log-action-btn"
        title="Copy logs to clipboard"
        onClick={(e) => {
          e.stopPropagation();
          const text = renderedLogs.map(formatTerminalLine).join('\n');
          navigator.clipboard.writeText(text);
        }}
      >
        Copy
      </button>
    )}
    <span className="log-drawer-chevron">{logDrawerOpen ? '▼' : '▲'}</span>
  </span>
</div>
```

**Step 4: Run tests**

```bash
CI=1 pnpm --dir apps/web test
```
Expected: all PASS, including the new test.

**Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/tests/app.test.tsx
git -c commit.gpgsign=false commit -m "fix(P2-9): replace nested button in log drawer with div[role=button] — valid markup"
```

---

## Group 5 — Refactoring

### Task 11: R1 — Consolidate ad-hoc `fetch()` calls in web components

**Files:**
- Modify: `apps/web/src/components/ScoringHealth.tsx`
- Modify: `apps/web/src/components/ConnectionsView.tsx`
- Modify: `apps/web/src/components/OpportunityMap.tsx`

**Step 1: Verify `apiFetch` is already exported from `api.ts`** (it was added in Task 1). It constructs the full URL from the path, so components should call `apiFetch('/v1/...')` instead of `fetch(`${apiUrl}/v1/...`)`.

**Step 2: Update `ScoringHealth.tsx`**

The component receives `apiUrl` as a prop and uses `fetch(`${apiUrl}/v1/scoring-health?profile=${profile}`)`.

Change:
```typescript
fetch(`${apiUrl}/v1/scoring-health?profile=${profile}`)
  .then((res) => { ... })
```
To:
```typescript
import { apiFetch } from '../api';
// ...
apiFetch(`/v1/scoring-health?profile=${profile}`)
  .then((res) => { ... })
```

Remove the `apiUrl` prop if it's only used for this fetch (check if `apiUrl` is passed elsewhere in the component first). If it can be removed, update the call site in `App.tsx` accordingly.

**Step 3: Update `ConnectionsView.tsx`**

Open the file, find fetch calls at lines 22–51. Apply the same pattern: import `apiFetch` and replace `fetch(buildApiUrl(...))` or `fetch(`${apiUrl}/v1/...`)` with `apiFetch(...)`.

**Step 4: Update `OpportunityMap.tsx`**

Same as above for lines 33–41.

**Step 5: Run tests**

```bash
CI=1 pnpm test
```
Expected: all PASS (behavior unchanged).

**Step 6: Commit**

```bash
git add apps/web/src/components/ScoringHealth.tsx apps/web/src/components/ConnectionsView.tsx apps/web/src/components/OpportunityMap.tsx
git -c commit.gpgsign=false commit -m "refactor(R1): consolidate ad-hoc fetch() calls to use apiFetch helper"
```

---

### Task 12: R2 — Extract repeated thesis projection SQL

**Files:**
- Modify: `apps/api/src/runtime/postgres_thesis_store.ts`

**Step 1: Identify the repeated select shape**

The following column fragment appears verbatim (or near-verbatim) in `list`, `getByKey`, `getAsListItem`, and `listPaginated`:
```sql
COUNT(DISTINCT te.signal_id)::int AS evidence_count,
COUNT(DISTINCT sm.source)::int AS source_count,
ROUND(COALESCE(AVG(sm.demand), 0))::int AS avg_demand,
ROUND(COALESCE(AVG(sm.timing), 0))::int AS avg_timing,
ROUND(COALESCE(AVG(sm.buildability), 0))::int AS avg_buildability,
ROUND(COALESCE(AVG(sm.virality), 0))::int AS avg_virality
```

**Step 2: Extract the constant**

At the top of the file (after imports, before `createPostgresThesisStore`), add:

```typescript
const THESIS_AGG_COLS = `
  COUNT(DISTINCT te.signal_id)::int AS evidence_count,
  COUNT(DISTINCT sm.source)::int AS source_count,
  ROUND(COALESCE(AVG(sm.demand), 0))::int AS avg_demand,
  ROUND(COALESCE(AVG(sm.timing), 0))::int AS avg_timing,
  ROUND(COALESCE(AVG(sm.buildability), 0))::int AS avg_buildability,
  ROUND(COALESCE(AVG(sm.virality), 0))::int AS avg_virality
`.trim();
```

**Step 3: Replace all occurrences**

In each of the 4 query sites, replace the inline column block with `${THESIS_AGG_COLS}`:

Before (in `list`):
```typescript
const sql = `
  SELECT tc.*,
         COUNT(DISTINCT te.signal_id)::int AS evidence_count,
         COUNT(DISTINCT sm.source)::int AS source_count,
         ROUND(COALESCE(AVG(sm.demand), 0))::int AS avg_demand,
         ROUND(COALESCE(AVG(sm.timing), 0))::int AS avg_timing,
         ROUND(COALESCE(AVG(sm.buildability), 0))::int AS avg_buildability,
         ROUND(COALESCE(AVG(sm.virality), 0))::int AS avg_virality
  FROM thesis_candidates tc
  ...
`;
```
After:
```typescript
const sql = `
  SELECT tc.*, ${THESIS_AGG_COLS}
  FROM thesis_candidates tc
  ...
`;
```

Repeat for `getByKey`, `getAsListItem`, and `listPaginated`.

**Step 4: Run tests**

```bash
CI=1 pnpm test
```
Expected: all PASS — SQL output is identical, behavior unchanged.

**Step 5: Commit**

```bash
git add apps/api/src/runtime/postgres_thesis_store.ts
git -c commit.gpgsign=false commit -m "refactor(R2): extract THESIS_AGG_COLS constant — eliminate SQL duplication across 4 query sites"
```

---

### Task 13: R3 — Extract shared persistence helpers

**Files:**
- Create: `apps/api/src/runtime/db_utils.ts`
- Modify: `apps/api/src/runtime/postgres_signal_store.ts`
- Modify: whichever file has the duplicate `toVectorLiteral` (check journal store or embed store)
- Modify: `apps/api/src/runtime/execution_logger.ts`
- Modify: `apps/api/src/runtime/execution_log_reader.ts`

**Step 1: Find `toVectorLiteral` duplicates**

```bash
grep -rn "toVectorLiteral" apps/api/src/
```
Note all files that define or use this function.

**Step 2: Create `db_utils.ts`**

```typescript
// apps/api/src/runtime/db_utils.ts

import { join } from 'node:path';

/** Convert a number[] to the `[x,y,z]` literal PostgreSQL expects for vector columns. */
export const toVectorLiteral = (embedding: number[]): string =>
  `[${embedding.join(',')}]`;

/** Canonical path for execution logs, relative to process cwd. */
export const EXEC_LOG_DIR = join(process.cwd(), 'logs', 'executions');
```

**Step 3: Update `postgres_signal_store.ts`**

Remove the local definition of `toVectorLiteral` (or its inline equivalent) and import from `db_utils`:
```typescript
import { sanitizeUrl, toVectorLiteral } from './db_utils';
```
(Move `sanitizeUrl` here too if you want, or keep it in `postgres_signal_store.ts` — either is fine.)

**Step 4: Update the journal/embed store**

Remove their local `toVectorLiteral` and import from `db_utils`.

**Step 5: Update `execution_logger.ts` and `execution_log_reader.ts`**

In `execution_logger.ts` line 25:
```typescript
const defaultLogDir = (): string => join(process.cwd(), 'logs', 'executions');
```
Replace with:
```typescript
import { EXEC_LOG_DIR } from './db_utils';
// use EXEC_LOG_DIR directly
```

In `execution_log_reader.ts`, replace the duplicated path constant with the import.

**Step 6: Run tests**

```bash
CI=1 pnpm test
```
Expected: all PASS.

**Step 7: Commit**

```bash
git add apps/api/src/runtime/db_utils.ts apps/api/src/runtime/postgres_signal_store.ts apps/api/src/runtime/execution_logger.ts apps/api/src/runtime/execution_log_reader.ts
git -c commit.gpgsign=false commit -m "refactor(R3): extract toVectorLiteral and EXEC_LOG_DIR into db_utils.ts"
```

---

### Task 14: R4 — Import `ThesisListItem` contract type in ThesisCard

**Files:**
- Modify: `apps/web/src/components/ThesisCard.tsx`

**Step 1: Check what `ThesisListItem` looks like in contracts**

`ThesisListItem` is in `packages/contracts/src/api.ts:120-139`. `ThesisCard.tsx` re-declares most of those fields as an inline type at lines 4–32.

**Step 2: Replace local type declaration with contract import**

In `ThesisCard.tsx`, the `thesis` prop type is currently an inline object type. Change it to use `ThesisListItem` from contracts:

```typescript
import type { ThesisListItem } from '@idea/contracts/src/api';

export type ThesisCardProps = {
  thesis: ThesisListItem;
  profileDisplay?: { badge: string; badgeColor: string } | null;
  isActive?: boolean;
  isGenerating?: boolean;
  onClick?: () => void;
  onExplore?: () => void;
  onView?: () => void;
  onLabelChange?: (label: 'favourite' | 'later' | 'dismissed' | null) => void;
};
```

If any local fields don't exist on `ThesisListItem`, check if they're actually used in the component body. If they're unused, remove them. If they're used, check if `ThesisListItem` in contracts needs updating (it might already have them — check the contract file).

**Step 3: Fix any resulting TypeScript errors**

Run the TypeScript compiler to find mismatches:
```bash
pnpm --dir apps/web exec tsc --noEmit
```
Fix field name mismatches one by one (common pattern: contract uses camelCase, local type might differ).

**Step 4: Run tests**

```bash
CI=1 pnpm test
```
Expected: all PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/ThesisCard.tsx
git -c commit.gpgsign=false commit -m "refactor(R4): ThesisCard uses ThesisListItem from contracts — remove local re-declaration"
```

---

### Task 15: R5 — Dynamic profile sources in ScoringHealth

**Files:**
- Modify: `apps/web/src/components/ScoringHealth.tsx`
- Modify: `apps/web/src/App.tsx`

**Step 1: Understand the current hardcoding**

`ScoringHealth.tsx:31-45` renders two hardcoded profile tabs: `'consumer'` and `'b2b'`. `App.tsx:464-474` already fetches the profile list (`fetchProfiles`) and stores it in state.

**Step 2: Add a `profiles` prop to `ScoringHealth`**

Change the `ScoringHealth` component signature from:
```typescript
export const ScoringHealth: React.FC<{ apiUrl: string }> = ({ apiUrl }) => {
```
To:
```typescript
import type { ProfileDisplay } from '../api';

export const ScoringHealth: React.FC<{
  apiUrl: string;
  profiles: ProfileDisplay[];
}> = ({ apiUrl, profiles }) => {
```

**Step 3: Replace hardcoded tabs with dynamic tabs from `profiles` prop**

Replace:
```tsx
<div className="profile-tabs" style={{ marginBottom: '0.75rem' }}>
  <button type="button" className={`profile-tab ${profile === 'consumer' ? 'active' : ''}`}
    onClick={() => setProfile('consumer')}>Consumer</button>
  <button type="button" className={`profile-tab ${profile === 'b2b' ? 'active' : ''}`}
    onClick={() => setProfile('b2b')}>B2B</button>
</div>
```
With:
```tsx
<div className="profile-tabs" style={{ marginBottom: '0.75rem' }}>
  {profiles.map((p) => (
    <button
      key={p.id}
      type="button"
      className={`profile-tab ${profile === p.id ? 'active' : ''}`}
      onClick={() => setProfile(p.id)}
    >
      {p.name}
    </button>
  ))}
</div>
```

Also set the default selected profile to the first in the list:
```typescript
const [profile, setProfile] = useState(profiles[0]?.id ?? 'consumer');
```

**Step 4: Update the call site in `App.tsx`**

Find where `<ScoringHealth apiUrl={API_BASE} />` is rendered and add the `profiles` prop:
```tsx
<ScoringHealth apiUrl={API_BASE} profiles={profiles} />
```

Where `profiles` is the state variable already populated from `fetchProfiles()`.

**Step 5: Run tests**

```bash
CI=1 pnpm test
```
Expected: all PASS.

**Step 6: Commit**

```bash
git add apps/web/src/components/ScoringHealth.tsx apps/web/src/App.tsx
git -c commit.gpgsign=false commit -m "refactor(R5): ScoringHealth renders profile tabs dynamically from API — remove consumer/b2b hardcode"
```

---

## Final Verification

**Step 1: Run full test suite**

```bash
CI=1 pnpm test
```
Expected: all pass.

**Step 2: Run linter**

```bash
pnpm lint
```
Check that no new errors were introduced (pre-existing 31 errors/15 warnings are acceptable, but the count should not increase).

**Step 3: Build the web app**

```bash
pnpm --filter @idea/web run build
```
Expected: clean build, no TypeScript errors.

**Step 4: Create PR**

```bash
git push origin HEAD
gh pr create --base dev --title "fix: audit remediation — P1 security, P2 bugs, refactoring" \
  --body "Closes all 9 issues from the 2026-03-09 audit plus 5 refactoring candidates.

## Changes
- P1: WS auth via handshake key, origin lockdown, localhost-only open mode
- P1: URL sanitization on ingest + render guard
- P1: Startup enforcement when API_KEY unset on non-localhost
- P2: Forward x-api-key in web HTTP client and WS handshake
- P2: Expose startRefresh only — guards concurrent manual refresh
- P2: Deep-dive promise dedup per thesis key
- P2: Stats query uses same filters as paginated list
- P2: signalCount/latestSignalAt in every WS broadcast
- P2: Fix nested button in log drawer
- Refactor: apiFetch helper, THESIS_AGG_COLS, db_utils.ts, ThesisCard contract type, dynamic ScoringHealth profiles

## Test plan
- CI=1 pnpm test — all pass
- pnpm lint — no new errors
- pnpm --filter @idea/web run build — clean"
```
