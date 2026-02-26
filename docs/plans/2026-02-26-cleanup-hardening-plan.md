# Cleanup & Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Full cleanup pass — fix security gaps, documentation holes, code quality issues, and test coverage before continuing feature testing.

**Architecture:** Four sequential phases (infra, security, code quality, tests). Each phase produces a clean commit. Dependencies flow forward: infra config enables security middleware, security middleware enables security tests.

**Tech Stack:** Fastify, @fastify/rate-limit, dotenv, @biomejs/biome, PostgreSQL, pg, TypeScript

---

### Task 1: Fix .gitignore

**Files:**
- Modify: `.gitignore`

**Step 1: Add missing entries to .gitignore**

Append to `.gitignore` (currently 9 lines):

```
.history/
.claude/
logs/
.pnpm-store/
apps/api/logs/
```

**Step 2: Verify nothing important is excluded**

Run: `git status`
Expected: The 5 previously-untracked directories no longer appear.

**Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add .history, .claude, logs, .pnpm-store to gitignore"
```

---

### Task 2: Externalize credentials from docker-compose and package.json

**Files:**
- Modify: `docker-compose.infra.yml:9`
- Modify: `package.json:17`
- Create: `scripts/db-migrate.sh`

**Step 1: Replace hardcoded POSTGRES_PASSWORD in docker-compose.infra.yml**

Change line 9 from:
```yaml
      POSTGRES_PASSWORD: idea_ai_dev
```
to:
```yaml
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-idea_ai_dev}
```

**Step 2: Create migration wrapper script**

Create `scripts/db-migrate.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Source .env if it exists
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5917}"
DB_USER="${DB_USER:-idea_ai}"
DB_NAME="${DB_NAME:-idea_ai}"

export PGPASSWORD="${POSTGRES_PASSWORD:-idea_ai_dev}"

for migration in apps/api/db/migrations/0001_init.sql \
                 apps/api/db/migrations/0002_memory.sql \
                 apps/api/db/migrations/0003_thesis.sql \
                 apps/api/db/migrations/0004_tsvector.sql; do
  echo "Running $migration..."
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$migration"
done

echo "All migrations complete."
```

Run: `chmod +x scripts/db-migrate.sh`

**Step 3: Update package.json db:migrate script**

Replace line 17 in `package.json`:
```json
"db:migrate": "./scripts/db-migrate.sh"
```

**Step 4: Test migration script**

Run: `pnpm db:migrate`
Expected: All 4 migrations run (idempotent due to IF NOT EXISTS).

**Step 5: Commit**

```bash
git add docker-compose.infra.yml package.json scripts/db-migrate.sh
git commit -m "chore: externalize DB credentials from compose and migrate script"
```

---

### Task 3: Create Docker operations documentation

**Files:**
- Create: `docs/operations/docker.md`

**Step 1: Write docker.md**

```markdown
# Docker Infrastructure

## Services

| Service  | Image                    | Host Port | Purpose              |
|----------|--------------------------|-----------|----------------------|
| postgres | pgvector/pgvector:pg17   | 5917      | Signal memory + theses |
| redis    | redis:7-alpine           | 6391      | Job queue (future)   |
| ollama   | ollama/ollama:latest     | 11434     | Local embeddings     |

## Start / Stop

```bash
# Start all infra
docker compose -f docker-compose.infra.yml up -d

# Stop (keep data)
docker compose -f docker-compose.infra.yml down

# Stop and delete all data
docker compose -f docker-compose.infra.yml down -v
```

## Database Migrations

```bash
pnpm db:migrate
```

Runs all migrations in `apps/api/db/migrations/` (0001-0004) idempotently.

## Ollama Model Setup

After first start, pull the embedding model:

```bash
docker exec idea-ai-ollama ollama pull nomic-embed-text
```

Verify:

```bash
docker exec idea-ai-ollama ollama list
```

## Volume Reset

To wipe all data and start fresh:

```bash
docker compose -f docker-compose.infra.yml down -v
docker compose -f docker-compose.infra.yml up -d
pnpm db:migrate
docker exec idea-ai-ollama ollama pull nomic-embed-text
```

## Health Checks

All services have built-in health checks. Verify with:

```bash
docker compose -f docker-compose.infra.yml ps
```

All services should show `(healthy)`.
```

**Step 2: Commit**

```bash
git add docs/operations/docker.md
git commit -m "docs: add Docker infrastructure operations guide"
```

---

### Task 4: Sync .env.example and fix setup.md

**Files:**
- Modify: `.env.example`
- Modify: `setup.md:8,76-81`

**Step 1: Update .env.example**

Update `AI_POST_SCRAPE_MAX_SIGNALS` from `6` to `80` (matches actual .env). Remove V2-only vars that aren't wired (`REDDIT_SUBREDDITS`, `PH_API_TOKEN`, `AGENT_SCHEDULE_CRON`, `AGENT_DUAL_ANALYST`, `NOISE_GATE_BATCH_SIZE`). Add new security vars:

```
# Security (optional — omit for open dev mode)
# API_KEY=
# CORS_ORIGINS=http://localhost:5173
# RATE_LIMIT_MAX=100
```

**Step 2: Fix setup.md**

- Line 8: Replace `/Users/vladimirtrifonov/src/ai/idea.ai` with `<project-root>`
- Lines 76-81: Replace the 2-migration section with:

```markdown
## 2.5 Apply DB migrations

```bash
pnpm db:migrate
```

This runs all migrations (0001_init through 0004_tsvector) idempotently.
```

**Step 3: Commit**

```bash
git add .env.example setup.md
git commit -m "docs: sync .env.example, fix setup.md migrations and paths"
```

---

### Task 5: CORS whitelist

**Files:**
- Modify: `apps/api/src/server.ts:11-18,66-77`

**Step 1: Write the failing test**

Create `apps/api/tests/cors.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

describe('CORS', () => {
  it('allows whitelisted origin', async () => {
    const app = buildServer({ corsOrigins: ['http://localhost:5173'] });
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' }
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('rejects non-whitelisted origin', async () => {
    const app = buildServer({ corsOrigins: ['http://localhost:5173'] });
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://evil.com' }
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows all origins when corsOrigins is empty', async () => {
    const app = buildServer({ corsOrigins: [] });
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://anything.com' }
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://anything.com');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --dir apps/api exec vitest run tests/cors.test.ts`
Expected: FAIL — `buildServer` doesn't accept `corsOrigins`.

**Step 3: Implement CORS whitelist**

In `apps/api/src/server.ts`, add `corsOrigins` to `ServerDeps` (line 11):

```typescript
export type ServerDeps = {
  listSignals: () => Promise<FeedRecord[]>;
  listConnectors: () => Promise<ConnectorStatusRecord[]>;
  listLogs: (query: ListLogsQuery) => Promise<ExecutionLogRecord[]>;
  getAiHealth: () => Promise<AiHealthRecord>;
  thesisStore?: ThesisStore;
  memoryStore?: PostgresMemoryStore | null;
  corsOrigins?: string[];
  apiKey?: string;
};
```

Replace the CORS hook (lines 66-77):

```typescript
  const allowedOrigins = new Set(resolvedDeps.corsOrigins ?? []);
  const openCors = allowedOrigins.size === 0;

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;

    if (origin && (openCors || allowedOrigins.has(origin))) {
      reply.header('Access-Control-Allow-Origin', origin);
    }
    reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key');
    reply.header('Vary', 'Origin');

    if (request.method === 'OPTIONS') {
      reply.code(204).send();
    }
  });
```

**Step 4: Wire in main.ts**

In `apps/api/src/main.ts`, parse `CORS_ORIGINS` from env and pass to `buildServer`:

```typescript
const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
```

Pass `corsOrigins` in the `buildServer()` call.

**Step 5: Run tests**

Run: `CI=1 pnpm test`
Expected: All tests pass (existing + new CORS tests).

**Step 6: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/main.ts apps/api/tests/cors.test.ts
git commit -m "feat: replace CORS origin reflection with configurable whitelist"
```

---

### Task 6: API key authentication

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/main.ts`

**Step 1: Write the failing test**

Add to `apps/api/tests/cors.test.ts` (rename file to `apps/api/tests/security.test.ts`):

```typescript
describe('API key auth', () => {
  it('returns 401 when API_KEY is set and request has no key', async () => {
    const app = buildServer({ apiKey: 'test-secret' });
    const res = await app.inject({ method: 'GET', url: '/v1/connectors' });
    expect(res.statusCode).toBe(401);
  });

  it('passes when correct key is provided', async () => {
    const app = buildServer({ apiKey: 'test-secret' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/connectors',
      headers: { 'x-api-key': 'test-secret' }
    });
    expect(res.statusCode).toBe(200);
  });

  it('skips auth for /health', async () => {
    const app = buildServer({ apiKey: 'test-secret' });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('skips auth when API_KEY is not set', async () => {
    const app = buildServer({});
    const res = await app.inject({ method: 'GET', url: '/v1/connectors' });
    expect(res.statusCode).toBe(200);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --dir apps/api exec vitest run tests/security.test.ts`
Expected: FAIL — no auth check.

**Step 3: Add auth hook to server.ts**

After the CORS hook, add:

```typescript
  const apiKey = resolvedDeps.apiKey;
  if (apiKey) {
    app.addHook('onRequest', async (request, reply) => {
      if (request.method === 'OPTIONS') return;
      if (request.url === '/health') return;
      const provided = request.headers['x-api-key'];
      if (provided !== apiKey) {
        reply.code(401).send({ error: 'Unauthorized' });
      }
    });
  }
```

**Step 4: Wire in main.ts**

```typescript
const apiKey = process.env.API_KEY || undefined;
```

Pass `apiKey` in the `buildServer()` call.

**Step 5: Run tests**

Run: `CI=1 pnpm test`
Expected: All pass.

**Step 6: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/main.ts apps/api/tests/security.test.ts
git commit -m "feat: add optional API key authentication middleware"
```

---

### Task 7: Rate limiting

**Files:**
- Modify: `apps/api/package.json` (add @fastify/rate-limit)
- Modify: `apps/api/src/server.ts`

**Step 1: Install dependency**

Run: `pnpm --dir apps/api add @fastify/rate-limit`

**Step 2: Write the failing test**

Add to `apps/api/tests/security.test.ts`:

```typescript
describe('rate limiting', () => {
  it('returns rate limit headers', async () => {
    const app = buildServer({ rateLimitMax: 5 });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
  });
});
```

**Step 3: Register rate limit plugin in server.ts**

```typescript
import rateLimit from '@fastify/rate-limit';
```

Inside `buildServer`, before routes:

```typescript
  const rateLimitMax = resolvedDeps.rateLimitMax ?? 100;
  await app.register(rateLimit, {
    max: rateLimitMax,
    timeWindow: '1 minute'
  });
```

Add `rateLimitMax?: number` to `ServerDeps`.

Note: Since `app.register` is async with Fastify, and `buildServer` is currently sync, change `buildServer` to async or use `app.after()`. The simplest approach: register rate limit and have Fastify resolve it automatically (Fastify handles async plugin registration internally when routes are called).

Actually Fastify's register returns a promise but the server handles it before the first request. The `app.inject()` in tests calls `app.ready()` implicitly. Keep `buildServer` sync and just call `void app.register(...)`.

**Step 4: Add stricter limit for synthesize endpoint**

In the theses route registration (`apps/api/src/routes/theses.ts`), add route-level config:

```typescript
  app.post('/v1/theses/synthesize', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (_request, reply) => {
    // ... existing handler
  });
```

**Step 5: Run tests**

Run: `CI=1 pnpm test`
Expected: All pass.

**Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/server.ts apps/api/src/routes/theses.ts apps/api/tests/security.test.ts
git commit -m "feat: add rate limiting with @fastify/rate-limit"
```

---

### Task 8: Fastify schema validation on routes

**Files:**
- Modify: `apps/api/src/routes/feed.ts`
- Modify: `apps/api/src/routes/theses.ts`
- Modify: `apps/api/src/routes/logs.ts`

**Step 1: Write failing test**

Add to `apps/api/tests/security.test.ts`:

```typescript
describe('schema validation', () => {
  it('rejects non-numeric page param', async () => {
    const app = buildServer({});
    const res = await app.inject({ method: 'GET', url: '/v1/signals?page=abc' });
    expect(res.statusCode).toBe(400);
  });
});
```

**Step 2: Add JSON Schema to feed route**

In `apps/api/src/routes/feed.ts`, add schema to the route:

```typescript
  app.get<{ Querystring: { page?: string; page_size?: string } }>('/v1/signals', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'string', pattern: '^[0-9]+$' },
          page_size: { type: 'string', pattern: '^[0-9]+$' }
        }
      }
    }
  }, async (request) => {
    // ... existing handler unchanged
  });
```

**Step 3: Add schema to theses :key route**

In `apps/api/src/routes/theses.ts`:

```typescript
  app.get('/v1/theses/:key', {
    schema: {
      params: {
        type: 'object',
        properties: {
          key: { type: 'string', minLength: 1, maxLength: 200 }
        },
        required: ['key']
      }
    }
  }, async (request, reply) => {
    // ... existing handler
  });
```

**Step 4: Add schema to logs route**

In `apps/api/src/routes/logs.ts`, add schema for the query params:

```typescript
  schema: {
    querystring: {
      type: 'object',
      properties: {
        limit: { type: 'string', pattern: '^[0-9]+$' },
        level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
        run_id: { type: 'string' },
        scope: { type: 'string', enum: ['all', 'session'] }
      }
    }
  }
```

**Step 5: Run tests**

Run: `CI=1 pnpm test`
Expected: All pass.

**Step 6: Commit**

```bash
git add apps/api/src/routes/feed.ts apps/api/src/routes/theses.ts apps/api/src/routes/logs.ts apps/api/tests/security.test.ts
git commit -m "feat: add Fastify JSON Schema validation to route params"
```

---

### Task 9: Replace custom dotenv with dotenv package

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/config/dotenv.ts`

**Step 1: Install dotenv**

Run: `pnpm --dir apps/api add dotenv`

**Step 2: Replace custom parser**

Replace `apps/api/src/config/dotenv.ts` entirely:

```typescript
import { config } from 'dotenv';
import { resolve } from 'node:path';

export const loadEnvFile = (filePath = '.env'): void => {
  config({ path: resolve(process.cwd(), filePath) });
};
```

**Step 3: Run tests**

Run: `CI=1 pnpm test`
Expected: All pass — behavior is identical for standard .env files.

**Step 4: Commit**

```bash
git add apps/api/package.json apps/api/src/config/dotenv.ts
git commit -m "refactor: replace custom dotenv parser with dotenv package"
```

---

### Task 10: Shared types via @idea/contracts

**Files:**
- Create: `packages/contracts/src/api.ts`
- Modify: `apps/api/src/routes/feed.ts`
- Modify: `apps/api/src/routes/connectors.ts`
- Modify: `apps/api/src/routes/logs.ts`
- Modify: `apps/api/src/routes/ai_health.ts`
- Modify: `apps/web/src/api.ts`

**Step 1: Create shared types file**

Create `packages/contracts/src/api.ts`:

```typescript
export type FeedRecord = {
  idea: string;
  score: number;
  top_source: string;
  snippet: string;
  source_url: string | null;
  next_action: 'validate_demand' | 'validate_pricing' | 'validate_channel';
  updated_at: string;
  pain?: number;
  timing?: number;
  buildability?: number;
};

export type SignalPage = {
  items: FeedRecord[];
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
};

export type ConnectorStatusRecord = {
  name: string;
  status: 'active' | 'disabled' | 'error';
  last_run: string | null;
};

export type ExecutionLogRecord = {
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  run_id: string;
  component: string;
  message: string;
  context?: Record<string, unknown>;
};

export type AiProviderHealthRecord = {
  provider: 'claude' | 'codex';
  enabled: boolean;
  status: 'disabled' | 'idle' | 'healthy' | 'degraded' | 'error';
  attempted: number;
  succeeded: number;
  failed: number;
  retries: number;
  last_error: string | null;
};

export type AiHealthRecord = {
  run_id: string | null;
  refreshed_at: string | null;
  provider_setting: 'claude' | 'codex' | 'both';
  judge_mode: 'single' | 'ensemble';
  fallback_enabled: boolean;
  retry_budget: number;
  post_scrape_enabled: boolean;
  post_scrape_max_signals: number;
  judge_max_signals: number;
  providers: AiProviderHealthRecord[];
};

export type ThesisListItem = {
  canonicalKey: string;
  title: string;
  confidence: number;
  status: string;
  evidenceCount: number;
  problemStatement: string;
  sourceCount: number;
};

export type AgentStatusRecord = {
  lastRun: {
    timestamp: string;
    thesesUpdated: number;
    newCandidates: number;
  } | null;
  investigateNext: string | null;
};
```

**Step 2: Update API route imports**

In each API route file, replace local type definitions with imports from `@idea/contracts/src/api`. For example in `apps/api/src/routes/feed.ts`:

```typescript
import type { FeedRecord } from '@idea/contracts/src/api';
```

Remove the local `FeedRecord` type definition. Repeat for `connectors.ts` (`ConnectorStatusRecord`), `logs.ts` (`ExecutionLogRecord`), `ai_health.ts` (`AiHealthRecord`, `AiProviderHealthRecord`).

**Step 3: Update web app imports**

In `apps/web/src/api.ts`, replace local type definitions with re-exports:

```typescript
export type {
  FeedRecord as SignalRecord,
  SignalPage,
  ConnectorStatusRecord as ConnectorRecord,
  ExecutionLogRecord,
  AiProviderHealthRecord,
  AiHealthRecord,
  ThesisListItem,
  AgentStatusRecord
} from '@idea/contracts/src/api';
```

Note: The web app uses `SignalRecord` and `ConnectorRecord` as aliases. Use `export type { X as Y }` to maintain the existing names.

**Step 4: Run tests**

Run: `CI=1 pnpm test`
Expected: All pass.

**Step 5: Commit**

```bash
git add packages/contracts/src/api.ts apps/api/src/routes/ apps/web/src/api.ts
git commit -m "refactor: move shared API types to @idea/contracts"
```

---

### Task 11: PostgresThesisStore

**Files:**
- Create: `apps/api/src/runtime/postgres_thesis_store.ts`
- Modify: `apps/api/src/main.ts:12`

**Step 1: Write the failing test**

Create `apps/api/tests/postgres_thesis_store.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createPostgresThesisStore } from '../src/runtime/postgres_thesis_store';

const mockQuery = vi.fn();
const mockPool = { query: mockQuery, end: vi.fn() } as any;

describe('PostgresThesisStore', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('list returns rows sorted by confidence desc', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { canonical_key: 'k1', title: 'T1', topic: 'ai', status: 'promoted', confidence: '80.00',
          problem_statement: 'p1', target_buyer: 'b1', proposed_solution: 's1',
          first_seen_at: new Date(), last_seen_at: new Date(), evidence_count: 3, source_count: 2 }
      ]
    });
    const store = createPostgresThesisStore({ pool: mockPool });
    const result = await store.list();
    expect(result).toHaveLength(1);
    expect(result[0].canonicalKey).toBe('k1');
    expect(result[0].confidence).toBe(80);
  });

  it('getByKey returns null when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const store = createPostgresThesisStore({ pool: mockPool });
    const result = await store.getByKey('missing');
    expect(result).toBeNull();
  });

  it('upsert calls INSERT ON CONFLICT', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const store = createPostgresThesisStore({ pool: mockPool });
    await store.upsert({
      canonicalKey: 'k1', title: 'T1', topic: 'ai', status: 'candidate',
      confidence: 50, scoreTotal: 50, problemStatement: 'p', targetBuyer: 'b',
      proposedSolution: 's', evidenceCount: 1, avgPain: 50, avgTiming: 50,
      avgBuildability: 50, latestObservedAt: '2026-01-01T00:00:00Z', evidence: []
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain('ON CONFLICT');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `CI=1 pnpm --dir apps/api exec vitest run tests/postgres_thesis_store.test.ts`
Expected: FAIL — module doesn't exist.

**Step 3: Implement PostgresThesisStore**

Create `apps/api/src/runtime/postgres_thesis_store.ts`:

```typescript
import type { Pool } from 'pg';
import type { ThesisDraft } from '../jobs/thesis_synthesizer';
import type { ThesisStore, ThesisStoreFilter } from './thesis_store';

type ThesisRow = {
  canonical_key: string;
  title: string;
  topic: string;
  status: string;
  confidence: string | number;
  problem_statement: string;
  target_buyer: string;
  proposed_solution: string;
  first_seen_at: Date;
  last_seen_at: Date;
  evidence_count: number;
  source_count: number;
};

const toNumber = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const rowToDraft = (row: ThesisRow): ThesisDraft => ({
  canonicalKey: row.canonical_key,
  title: row.title,
  topic: row.topic,
  status: row.status as ThesisDraft['status'],
  confidence: toNumber(row.confidence),
  scoreTotal: toNumber(row.confidence),
  problemStatement: row.problem_statement,
  targetBuyer: row.target_buyer,
  proposedSolution: row.proposed_solution,
  evidenceCount: toNumber(row.evidence_count),
  avgPain: 0,
  avgTiming: 0,
  avgBuildability: 0,
  latestObservedAt: new Date(row.last_seen_at).toISOString(),
  evidence: []
});

export const createPostgresThesisStore = ({ pool }: { pool: Pool }): ThesisStore & { close: () => Promise<void> } => ({
  async list(filter?: ThesisStoreFilter): Promise<ThesisDraft[]> {
    const where = filter?.status ? 'WHERE status = $1' : '';
    const params = filter?.status ? [filter.status] : [];
    const sql = `
      SELECT tc.*, COUNT(DISTINCT te.signal_id)::int AS evidence_count,
             COUNT(DISTINCT sm.source)::int AS source_count
      FROM thesis_candidates tc
      LEFT JOIN thesis_evidence te ON te.thesis_id = tc.id
      LEFT JOIN signal_memory sm ON sm.signal_id = te.signal_id
      ${where}
      GROUP BY tc.id
      ORDER BY tc.confidence DESC
    `;
    const result = await pool.query<ThesisRow>(sql, params);
    return result.rows.map(rowToDraft);
  },

  async getByKey(canonicalKey: string): Promise<ThesisDraft | null> {
    const result = await pool.query<ThesisRow>(
      `SELECT tc.*, COUNT(DISTINCT te.signal_id)::int AS evidence_count,
              COUNT(DISTINCT sm.source)::int AS source_count
       FROM thesis_candidates tc
       LEFT JOIN thesis_evidence te ON te.thesis_id = tc.id
       LEFT JOIN signal_memory sm ON sm.signal_id = te.signal_id
       WHERE tc.canonical_key = $1
       GROUP BY tc.id`,
      [canonicalKey]
    );
    return result.rows[0] ? rowToDraft(result.rows[0]) : null;
  },

  async upsert(draft: ThesisDraft): Promise<void> {
    await pool.query(
      `INSERT INTO thesis_candidates
        (canonical_key, title, topic, status, confidence, problem_statement,
         target_buyer, proposed_solution, first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       ON CONFLICT (canonical_key) DO UPDATE SET
         title = EXCLUDED.title,
         status = EXCLUDED.status,
         confidence = EXCLUDED.confidence,
         problem_statement = EXCLUDED.problem_statement,
         target_buyer = EXCLUDED.target_buyer,
         proposed_solution = EXCLUDED.proposed_solution,
         last_seen_at = NOW(),
         updated_at = NOW()`,
      [
        draft.canonicalKey, draft.title, draft.topic, draft.status,
        draft.confidence, draft.problemStatement,
        draft.targetBuyer, draft.proposedSolution
      ]
    );
  },

  async close(): Promise<void> {}
});
```

**Step 4: Wire into main.ts**

In `apps/api/src/main.ts`, replace `new InMemoryThesisStore()` with conditional:

```typescript
import { createPostgresThesisStore } from './runtime/postgres_thesis_store';
import pg from 'pg';

const thesisStore = databaseUrl
  ? createPostgresThesisStore({ pool: new pg.Pool({ connectionString: databaseUrl, max: 4 }) })
  : new InMemoryThesisStore();
```

**Step 5: Run tests**

Run: `CI=1 pnpm test`
Expected: All pass.

**Step 6: Commit**

```bash
git add apps/api/src/runtime/postgres_thesis_store.ts apps/api/src/main.ts apps/api/tests/postgres_thesis_store.test.ts
git commit -m "feat: add PostgresThesisStore, theses persist across restarts"
```

---

### Task 12: Complete agent runner TODOs

**Files:**
- Modify: `apps/api/src/jobs/agent_runner.ts:13-17,33-37`

**Step 1: Add memoryStore to AgentRunnerDeps**

```typescript
export type AgentRunnerDeps = {
  thesisStore: ThesisStore;
  memoryStore: PostgresMemoryStore | null;
  runClaude: (input: { prompt: string; timeoutMs?: number }) => Promise<RunPromptResult>;
  runCodex: (input: { prompt: string; timeoutMs?: number }) => Promise<RunPromptResult>;
};
```

**Step 2: Wire recentSignals and trendSummary**

Replace lines 33-37:

```typescript
  const recentSignals = deps.memoryStore
    ? (await deps.memoryStore.listAllSignals(50)).map((s) => ({
        id: s.signal_id,
        topic: s.topic,
        source: s.source,
        text: s.canonical_text,
        pain: s.pain,
        timing: s.timing
      }))
    : [];

  const trendSummary = deps.memoryStore
    ? await deps.memoryStore.retriever.getTrendWindows({
        topic: 'general',
        source: 'all',
        canonicalText: ''
      })
    : [];

  const ctx: AgentContext = {
    activeTheses,
    recentSignals,
    trendSummary
  };
```

**Step 3: Update callers**

Check where `runResearchAgent` is called and add `memoryStore` to the deps. Likely in `apps/api/src/jobs/daily_scheduler.ts` or wherever the agent is triggered.

**Step 4: Run tests**

Run: `CI=1 pnpm test`
Expected: All pass.

**Step 5: Commit**

```bash
git add apps/api/src/jobs/agent_runner.ts
git commit -m "feat: wire agent runner to memory store for signal context"
```

---

### Task 13: Set up Biome linter

**Files:**
- Create: `biome.json`
- Modify: root `package.json` and all workspace `package.json` files

**Step 1: Install Biome**

Run: `pnpm add -Dw @biomejs/biome`

**Step 2: Create biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": { "noForEach": "off" },
      "style": { "noNonNullAssertion": "off" },
      "suspicious": { "noExplicitAny": "off" }
    }
  },
  "formatter": { "enabled": false },
  "files": {
    "ignore": ["node_modules", "dist", "coverage", ".pnpm-store", "logs"]
  }
}
```

**Step 3: Replace stub lint scripts**

In root `package.json`:
```json
"lint": "biome check ."
```

Remove individual `lint` scripts from workspace packages (they'll use the root one).

**Step 4: Run lint and fix issues**

Run: `pnpm lint`
Expected: Some lint warnings/errors. Fix any auto-fixable ones with `pnpm exec biome check --write .`

**Step 5: Commit**

```bash
git add biome.json package.json apps/*/package.json packages/*/package.json
git commit -m "chore: set up Biome linter, replace stub lint scripts"
```

---

### Task 14: Phase 1-3 integration commit

**Step 1: Run full test suite**

Run: `CI=1 pnpm test`
Expected: All existing 136+ tests pass, plus new security and store tests.

**Step 2: Verify lint passes**

Run: `pnpm lint`
Expected: Clean or only non-critical warnings.

**Step 3: Verify API starts**

Run: `pnpm --dir apps/api dev` (manually test briefly)
Expected: API starts, theses load from Postgres.

---

### Task 15: Postgres memory store tests

**Files:**
- Create: `apps/api/tests/postgres_memory_store.test.ts`

**Step 1: Write tests with mock pool**

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn().mockResolvedValue({
  query: mockQuery,
  release: mockRelease
});
const mockPool = { query: mockQuery, connect: mockConnect, end: vi.fn() } as any;

// Use vi.doMock to inject mock pool
vi.doMock('pg', () => ({
  default: { Pool: vi.fn(() => mockPool) },
  Pool: vi.fn(() => mockPool)
}));

describe('PostgresMemoryStore', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('listAllSignals returns mapped rows', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ping
    mockQuery.mockResolvedValueOnce({
      rows: [{
        signal_id: 's1', topic: 'ai', source: 'hn',
        canonical_text: 'test', observed_at: new Date('2026-01-01'),
        pain: '70', timing: '80', buildability: '60', blended: '72'
      }]
    });
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
    const signals = await store.listAllSignals(10);
    expect(signals).toHaveLength(1);
    expect(signals[0].signal_id).toBe('s1');
    expect(signals[0].pain).toBe(70);
  });

  it('ping succeeds', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
    await expect(store.ping()).resolves.toBeUndefined();
  });
});
```

**Step 2: Run tests**

Run: `CI=1 pnpm --dir apps/api exec vitest run tests/postgres_memory_store.test.ts`
Expected: PASS.

**Step 3: Commit**

```bash
git add apps/api/tests/postgres_memory_store.test.ts
git commit -m "test: add postgres memory store unit tests"
```

---

### Task 16: Final verification and commit

**Step 1: Run complete test suite**

Run: `CI=1 pnpm test`
Expected: 150+ tests passing, 0 failures.

**Step 2: Run lint**

Run: `pnpm lint`
Expected: Clean.

**Step 3: Verify git status is clean**

Run: `git status`
Expected: Clean working tree.

**Step 4: Tag the milestone**

```bash
git tag -a v1.1-hardened -m "Cleanup and hardening pass complete"
```
