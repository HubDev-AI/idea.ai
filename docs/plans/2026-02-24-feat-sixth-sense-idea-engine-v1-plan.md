# Sixth Sense Idea Engine V1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship v1 of the automated idea-intelligence app that ingests 6 connectors, scores opportunities, and publishes a ranked one-line signal feed for solo founders.

**Architecture:** Event-driven queue system with isolated workers for ingest, normalize, score, and rank stages. Open connectors run by default; Exa/Perigon run as BYO connectors only when user credentials are configured. AI scoring uses local CLI adapters with `claude -p` as primary and `codex exec` as fallback. Sixth-sense scoring reads local historical memory from relational + vector stores (time-window aggregates + semantic recall), not only current snapshots.

**Tech Stack:** TypeScript, Node.js 22, pnpm workspaces, PostgreSQL (+ pgvector), Redis, BullMQ, Fastify API, React + Vite frontend, Vitest.

---

## Locked Product Decisions

- Target user: solo founders.
- Connectors: Hacker News, GitHub Issues, Greenhouse, Lever, Exa (BYO), Perigon (BYO).
- Signal output: one-line decision-ready feed entry (`idea + score + source + snippet + next_action`).
- Blended score: pain 40%, timing 40%, buildability 20%.
- Buildability: 3 independent LLM judges, median score.
- Cadence: hourly for high-velocity sources, daily for slow sources.
- AI runtime: local CLI adapters only (`claude -p` primary, `codex exec` fallback), no API key billing.
- 30-day success metric: at least 1 detected idea reaches paid pilot/preorder.
- Sixth-sense memory: local historical + semantic memory (7d/30d/90d trend windows + vector recall over prior signals).

## Default Assumptions To Unblock Build

- BYO connectors are disabled unless credentials are present.
- Connector budgets default to conservative limits in `.env`.
- Raw source payload retention defaults to 30 days.

## Task 1: Workspace Bootstrap

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `vitest.config.ts`
- Create: `apps/api/package.json`
- Create: `apps/web/package.json`
- Create: `packages/contracts/package.json`
- Create: `packages/connectors/package.json`
- Create: `packages/pipeline/package.json`
- Create: `packages/ai-runtime/package.json`

**Step 1: Write the failing test**

Create `packages/contracts/tests/workspace-smoke.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { SIGNAL_VERSION } from '../src/signal';

describe('workspace smoke', () => {
  it('loads shared contracts package', () => {
    expect(SIGNAL_VERSION).toBe('v1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest packages/contracts/tests/workspace-smoke.test.ts`
Expected: FAIL with module/file-not-found (`../src/signal`).

**Step 3: Write minimal implementation**

Create minimal `packages/contracts/src/signal.ts` exporting `SIGNAL_VERSION = 'v1'` and wire workspace scripts in root `package.json`.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest packages/contracts/tests/workspace-smoke.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore vitest.config.ts apps/api/package.json apps/web/package.json packages/contracts/package.json packages/connectors/package.json packages/pipeline/package.json packages/ai-runtime/package.json packages/contracts/src/signal.ts packages/contracts/tests/workspace-smoke.test.ts
git commit -m "chore: bootstrap monorepo workspace"
```

## Task 2: Canonical Event and DB Contracts

**Files:**
- Create: `packages/contracts/src/events.ts`
- Create: `packages/contracts/src/signal.ts`
- Create: `packages/contracts/src/db.ts`
- Create: `packages/contracts/tests/events.test.ts`
- Create: `apps/api/db/migrations/0001_init.sql`

**Step 1: Write the failing test**

In `packages/contracts/tests/events.test.ts`, validate parsing of:
- `ingest.raw.received`
- `signal.scored`
- `signal.published`

Use `zod` schemas and assert invalid payloads throw.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @idea/contracts test`
Expected: FAIL for missing schemas.

**Step 3: Write minimal implementation**

Add strict `zod` schemas for envelopes and a SQL migration with tables:
- `raw_events`
- `normalized_signals`
- `published_signals`
- `connector_state`
- `signal_embeddings` (pgvector)
- `trend_snapshots` (time-window aggregates)

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @idea/contracts test`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/contracts/src/events.ts packages/contracts/src/signal.ts packages/contracts/src/db.ts packages/contracts/tests/events.test.ts apps/api/db/migrations/0001_init.sql
git commit -m "feat: define canonical event and signal schemas"
```

## Task 2B: Local Memory + RAG Indexing

**Files:**
- Create: `packages/pipeline/src/memory/embed.ts`
- Create: `packages/pipeline/src/memory/retrieve.ts`
- Create: `packages/pipeline/src/memory/windows.ts`
- Create: `packages/pipeline/tests/memory.test.ts`
- Create: `apps/api/src/jobs/memory_index.ts`

**Step 1: Write the failing test**

`memory.test.ts` should assert:
- normalized signals are embedded and stored in `signal_embeddings`
- retrieval returns top-k semantically similar prior signals
- trend windows produce aggregates for 7d/30d/90d

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @idea/pipeline test packages/pipeline/tests/memory.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement:
- embedding writer worker (batch insert/update into `signal_embeddings`)
- retriever used by scoring workers (`topKBySimilarity`)
- rolling aggregate job for `trend_snapshots` at 7d/30d/90d windows

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @idea/pipeline test packages/pipeline/tests/memory.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/pipeline/src/memory/embed.ts packages/pipeline/src/memory/retrieve.ts packages/pipeline/src/memory/windows.ts packages/pipeline/tests/memory.test.ts apps/api/src/jobs/memory_index.ts
git commit -m "feat: add local memory and rag indexing pipeline"
```

## Task 3: Queue Topology and Worker Runtime

**Files:**
- Create: `packages/pipeline/src/queues.ts`
- Create: `packages/pipeline/src/worker.ts`
- Create: `packages/pipeline/src/publish.ts`
- Create: `packages/pipeline/tests/worker-routing.test.ts`
- Create: `apps/api/src/bootstrap/queues.ts`

**Step 1: Write the failing test**

In `worker-routing.test.ts`, assert job routes:
- `ingest:*` -> normalize queue
- `normalize:*` -> score queue
- `score:*` -> rank queue
- `rank:*` -> publish queue

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @idea/pipeline test`
Expected: FAIL due missing queue registry.

**Step 3: Write minimal implementation**

Implement BullMQ queue names:
- `ingest.hourly`
- `ingest.daily`
- `normalize`
- `score.pain`
- `score.timing`
- `score.buildability`
- `rank`
- `publish`

Add Redis connection config via `REDIS_URL`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @idea/pipeline test`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/pipeline/src/queues.ts packages/pipeline/src/worker.ts packages/pipeline/src/publish.ts packages/pipeline/tests/worker-routing.test.ts apps/api/src/bootstrap/queues.ts
git commit -m "feat: add event-driven queue topology and routing"
```

## Task 4: Open Connector Ingestion (HN, GitHub Issues, Greenhouse, Lever)

**Files:**
- Create: `packages/connectors/src/hn.ts`
- Create: `packages/connectors/src/github_issues.ts`
- Create: `packages/connectors/src/greenhouse.ts`
- Create: `packages/connectors/src/lever.ts`
- Create: `packages/connectors/src/common/http.ts`
- Create: `packages/connectors/tests/open-connectors.test.ts`
- Create: `apps/api/src/jobs/ingest_open.ts`

**Step 1: Write the failing test**

`open-connectors.test.ts` should assert each connector returns normalized `RawEventInput[]` with:
- stable `source_item_id`
- source timestamp
- text body/snippet
- URL

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @idea/connectors test`
Expected: FAIL for missing connector implementations.

**Step 3: Write minimal implementation**

Implement fetchers with retry/backoff and per-source limit defaults.

Cadence mapping defaults:
- hourly: Hacker News, GitHub Issues
- daily: Greenhouse, Lever

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @idea/connectors test`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connectors/src/hn.ts packages/connectors/src/github_issues.ts packages/connectors/src/greenhouse.ts packages/connectors/src/lever.ts packages/connectors/src/common/http.ts packages/connectors/tests/open-connectors.test.ts apps/api/src/jobs/ingest_open.ts
git commit -m "feat: add open connector ingestion workers"
```

## Task 5: BYO Connectors (Exa, Perigon)

**Files:**
- Create: `packages/connectors/src/exa_byo.ts`
- Create: `packages/connectors/src/perigon_byo.ts`
- Create: `packages/connectors/src/byo_guard.ts`
- Create: `packages/connectors/tests/byo-connectors.test.ts`
- Create: `apps/api/src/jobs/ingest_byo.ts`

**Step 1: Write the failing test**

`byo-connectors.test.ts` should assert:
- missing credentials => connector skipped with explicit status
- present credentials => connector returns events

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @idea/connectors test packages/connectors/tests/byo-connectors.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement credential guards:
- `EXA_API_KEY`
- `PERIGON_API_KEY`

Implement budget caps:
- `EXA_DAILY_BUDGET_USD`
- `PERIGON_DAILY_BUDGET_USD`

Emit skip telemetry when disabled.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @idea/connectors test packages/connectors/tests/byo-connectors.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connectors/src/exa_byo.ts packages/connectors/src/perigon_byo.ts packages/connectors/src/byo_guard.ts packages/connectors/tests/byo-connectors.test.ts apps/api/src/jobs/ingest_byo.ts
git commit -m "feat: add BYO connectors with credential and budget guards"
```

## Task 6: AI Runtime Adapter (`claude -p` -> `codex exec` fallback)

**Files:**
- Create: `packages/ai-runtime/src/claude.ts`
- Create: `packages/ai-runtime/src/codex.ts`
- Create: `packages/ai-runtime/src/client.ts`
- Create: `packages/ai-runtime/src/types.ts`
- Create: `packages/ai-runtime/tests/client.test.ts`

**Step 1: Write the failing test**

`client.test.ts` should assert:
- primary command is `claude -p`
- fallback to `codex exec --json -o` on timeout/non-zero exit
- parsed final text payload is returned

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @idea/ai-runtime test`
Expected: FAIL.

**Step 3: Write minimal implementation**

Use `child_process.spawn` with timeout and structured parser for:
- Claude JSON output
- Codex JSONL + output file

Expose API:

```ts
runPrompt({ prompt, timeoutMs, preferredProvider }): Promise<{ text: string; provider: 'claude' | 'codex'; meta: Record<string, unknown> }>;
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @idea/ai-runtime test`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/ai-runtime/src/claude.ts packages/ai-runtime/src/codex.ts packages/ai-runtime/src/client.ts packages/ai-runtime/src/types.ts packages/ai-runtime/tests/client.test.ts
git commit -m "feat: implement local CLI AI runtime adapter"
```

## Task 7: Scoring Pipeline (Pain, Timing, Buildability)

**Files:**
- Create: `packages/pipeline/src/scoring/pain.ts`
- Create: `packages/pipeline/src/scoring/timing.ts`
- Create: `packages/pipeline/src/scoring/buildability.ts`
- Create: `packages/pipeline/src/scoring/blend.ts`
- Create: `packages/pipeline/tests/scoring.test.ts`
- Create: `apps/api/src/jobs/score.ts`

**Step 1: Write the failing test**

`scoring.test.ts` should assert:
- pain/timing/buildability each in `[0,100]`
- buildability uses 3 judge outputs and median
- blended score uses `0.4*pain + 0.4*timing + 0.2*buildability`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @idea/pipeline test packages/pipeline/tests/scoring.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement deterministic blend + buildability median helper.

Example:

```ts
export const blendedScore = ({ pain, timing, buildability }: Scores) =>
  Math.round((0.4 * pain + 0.4 * timing + 0.2 * buildability) * 100) / 100;
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @idea/pipeline test packages/pipeline/tests/scoring.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/pipeline/src/scoring/pain.ts packages/pipeline/src/scoring/timing.ts packages/pipeline/src/scoring/buildability.ts packages/pipeline/src/scoring/blend.ts packages/pipeline/tests/scoring.test.ts apps/api/src/jobs/score.ts
git commit -m "feat: add scoring workers and blended rank formula"
```

## Task 8: Ranking and Adaptive Next Action Generation

**Files:**
- Create: `packages/pipeline/src/rank.ts`
- Create: `packages/pipeline/src/recommend_action.ts`
- Create: `packages/pipeline/tests/rank.test.ts`
- Create: `apps/api/src/jobs/rank_publish.ts`

**Step 1: Write the failing test**

`rank.test.ts` should assert signals are sorted by blended score and next action picks one of:
- `validate_demand`
- `validate_pricing`
- `validate_channel`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @idea/pipeline test packages/pipeline/tests/rank.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement ranker and rule-based adaptive action selector using score pattern thresholds.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @idea/pipeline test packages/pipeline/tests/rank.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/pipeline/src/rank.ts packages/pipeline/src/recommend_action.ts packages/pipeline/tests/rank.test.ts apps/api/src/jobs/rank_publish.ts
git commit -m "feat: publish ranked signals with adaptive recommendations"
```

## Task 9: API Surface for Feed and Connector Health

**Files:**
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/routes/feed.ts`
- Create: `apps/api/src/routes/connectors.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/tests/feed.test.ts`

**Step 1: Write the failing test**

`feed.test.ts` should assert:
- `GET /v1/signals` returns one-line feed records
- `GET /v1/connectors` returns status (`active|disabled|error`) and last run

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @idea/api test`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement Fastify routes and DTO mapping to:

```json
{
  "idea": "string",
  "score": 0,
  "top_source": "string",
  "snippet": "string",
  "next_action": "validate_demand|validate_pricing|validate_channel",
  "updated_at": "ISO-8601"
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @idea/api test`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/routes/feed.ts apps/api/src/routes/connectors.ts apps/api/src/routes/health.ts apps/api/tests/feed.test.ts
git commit -m "feat: expose signal feed and connector health API"
```

## Task 10: Web Feed UI

**Files:**
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/api.ts`
- Create: `apps/web/src/components/SignalRow.tsx`
- Create: `apps/web/src/components/ConnectorStatus.tsx`
- Create: `apps/web/src/styles.css`
- Create: `apps/web/tests/app.test.tsx`

**Step 1: Write the failing test**

`app.test.tsx` should assert feed rows render:
- idea text
- blended score
- source/snippet
- recommended next action badge

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @idea/web test`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement simple responsive dashboard with:
- top section: connector health
- main list: ranked one-line signals
- refresh indicator showing hourly/daily updates

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @idea/web test`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/main.tsx apps/web/src/App.tsx apps/web/src/api.ts apps/web/src/components/SignalRow.tsx apps/web/src/components/ConnectorStatus.tsx apps/web/src/styles.css apps/web/tests/app.test.tsx
git commit -m "feat: build decision-ready signal feed UI"
```

## Task 11: Scheduling, Operations, and Guardrails

**Files:**
- Create: `apps/api/src/jobs/scheduler.ts`
- Create: `apps/api/src/config/env.ts`
- Create: `apps/api/src/config/limits.ts`
- Create: `.env.example`
- Create: `docs/operations/runbook.md`
- Create: `docs/operations/provider-policy.md`

**Step 1: Write the failing test**

Create `apps/api/tests/scheduler.test.ts` asserting:
- hourly connectors enqueue every hour
- daily connectors enqueue once/day
- disabled BYO connector is not scheduled

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @idea/api test apps/api/tests/scheduler.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement scheduler with env-driven lists and defaults:
- `HOURLY_CONNECTORS=hn,github_issues`
- `DAILY_CONNECTORS=greenhouse,lever,exa_byo,perigon_byo`

Document operational rules (timeouts, retries, cost caps, connector disable switches, CLI provider selection).

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @idea/api test apps/api/tests/scheduler.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/api/src/jobs/scheduler.ts apps/api/src/config/env.ts apps/api/src/config/limits.ts .env.example apps/api/tests/scheduler.test.ts docs/operations/runbook.md docs/operations/provider-policy.md
git commit -m "feat: add scheduler, env guardrails, and ops docs"
```

## Task 12: End-to-End Verification and Baseline Metrics

**Files:**
- Create: `apps/api/tests/e2e/pipeline.e2e.test.ts`
- Create: `scripts/dev/smoke.sh`
- Create: `docs/metrics/v1-baseline.md`

**Step 1: Write the failing test**

`pipeline.e2e.test.ts` should simulate one connector payload through ingest -> normalize -> score -> rank -> publish and assert one feed row exists.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @idea/api test apps/api/tests/e2e/pipeline.e2e.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Add test fixtures + smoke script:

```bash
pnpm install
pnpm test
pnpm --filter @idea/api dev &
pnpm --filter @idea/web dev
```

Capture baseline metrics format in `docs/metrics/v1-baseline.md`:
- signals/day
- % with valid next action
- time from ingest to publish
- count of ideas progressed to pilot/preorder

**Step 4: Run test to verify it passes**

Run: `pnpm test`
Expected: PASS across workspace.

**Step 5: Commit**

```bash
git add apps/api/tests/e2e/pipeline.e2e.test.ts scripts/dev/smoke.sh docs/metrics/v1-baseline.md
git commit -m "test: add end-to-end pipeline verification and baseline metrics"
```

## Verification Gates

Run these before claiming completion:

```bash
pnpm install
pnpm lint
pnpm test
pnpm --filter @idea/api test
pnpm --filter @idea/web test
```

Expected: all pass; no skipped critical tests.

## Risks and Mitigations

- Local CLI auth state can break scoring workers.
  - Mitigation: startup self-check endpoint for `claude` and `codex` availability.
- BYO connector cost spikes.
  - Mitigation: strict daily cost caps + hard stop + telemetry.
- Duplicate noisy signals.
  - Mitigation: deterministic dedupe key (`source + source_item_id + normalized_hash`).
- Weak-signal ranking overfits to short-term spikes.
  - Mitigation: score against 7d/30d/90d baselines + semantic retrieval of historical analogs.

## Definition of Done

- 6 connectors integrated (4 open default, 2 BYO optional).
- Event-driven pipeline publishes ranked one-line feed entries.
- Sixth-sense scoring uses local historical + semantic memory (not moment-only data).
- Buildability uses 3-judge median.
- API + web feed operational locally.
- End-to-end tests pass.
- Metrics document tracks pilot/preorder conversion target.
