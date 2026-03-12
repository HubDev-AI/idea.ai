# Research Agent And Dashboard Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the validated runtime, API, and UI correctness bugs without changing the product model, adding polling, or breaking the existing websocket-driven app.

**Architecture:** Land the fixes in small, test-first slices that preserve current API shapes wherever possible. Prioritize transport/state correctness first, then isolate profile-specific agent behavior, then align fallback APIs and explain surfaces with production semantics, and finally harden startup/shutdown and scheduling edge cases.

**Tech Stack:** Fastify, Socket.IO, React, TypeScript, PostgreSQL, Vitest, pnpm

---

## Non-Negotiable Guardrails

- Keep research-agent lifecycle websocket-driven. Do not add polling.
- Preserve primary-plus-fallback provider behavior when `DEBATE_ENABLED=false`.
- Do not change successful payload shapes unless the change is additive or clearly fixes wrong semantics.
- Every behavior change must land with focused regression tests first.
- Split the work into small PRs so each slice can be reverted independently if needed.

## Recommended PR Sequence

1. Transport and status correctness
2. Research-agent profile isolation and prompt/runtime fixes
3. API fallback parity and connector state correctness
4. Explain surface and UI truthfulness
5. Startup/shutdown hardening and final regression sweep

## Task 1: Establish Regression Harness

**Files:**
- Modify: `apps/web/tests/app.test.tsx`
- Modify: `apps/api/tests/agent-status-route.test.ts`
- Create: `apps/api/tests/startup-agent-status.test.ts`
- Create: `apps/api/tests/fallback-routes.test.ts`
- Create: `apps/api/tests/refresh-meta.test.ts`

**Steps:**
1. Add a failing web test proving Socket.IO uses the configured API origin, not the page origin.
2. Add a failing API test for startup state: `lastAttempt` can be newer than `lastRun`, and restart logic must treat them differently.
3. Add failing route tests for in-memory `/v1/signals` and `/v1/theses` so filters, paging, sort, and profile semantics match the DB-backed path.
4. Add a failing refresh-meta test asserting pre-refresh timestamps are `null`, not fabricated process start times.
5. Run only the new tests and confirm they fail for the current reasons.

**Verification:**
- `CI=1 pnpm --filter @idea/api test -- --run apps/api/tests/agent-status-route.test.ts apps/api/tests/startup-agent-status.test.ts apps/api/tests/fallback-routes.test.ts apps/api/tests/refresh-meta.test.ts`
- `CI=1 pnpm --filter @idea/web test -- --run apps/web/tests/app.test.tsx`

**Commit:**
- `test: add regression coverage for transport and fallback behavior`

## Task 2: Unify REST And WebSocket Origin Resolution

**Files:**
- Modify: `apps/web/src/useSocket.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/web/tests/app.test.tsx`

**Steps:**
1. Add a shared client-side socket base URL resolver derived from the same env source as REST.
2. Make Socket.IO connect to the resolved backend origin instead of implicit same-origin.
3. Keep the existing websocket path and auth behavior intact.
4. Tighten the server websocket CORS/origin handling so configured non-localhost origins work without reopening access wider than necessary.
5. Re-run the transport tests and the existing websocket/manual-run tests.

**Verification:**
- `CI=1 pnpm --filter @idea/web test -- --run apps/web/tests/app.test.tsx`
- `CI=1 pnpm --filter @idea/web build`

**Commit:**
- `fix: align websocket origin with configured api base`

## Task 3: Make Refresh Timing And Metadata Truthful

**Files:**
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/runtime/live_read_model.ts`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/api/tests/refresh-meta.test.ts`

**Steps:**
1. Stop coupling connector refresh scheduling to `agentIntervalMs`; introduce or use the read-model refresh interval consistently end-to-end.
2. Instantiate the read model with the actual refresh interval used by the scheduler so `getRefreshMeta()` and timers match reality.
3. Return `null` for `last_hourly_run` and `last_daily_run` until a real refresh has completed.
4. Keep the sidebar in a `pending` state when no refresh has ever happened.
5. Confirm countdowns and scheduler cadence stay aligned after startup and after a real refresh.

**Verification:**
- `CI=1 pnpm --filter @idea/api test -- --run apps/api/tests/refresh-meta.test.ts`
- `CI=1 pnpm --filter @idea/web test -- --run apps/web/tests/app.test.tsx`

**Commit:**
- `fix: align refresh scheduler with reported metadata`

## Task 4: Preserve Connector Truth Across Refresh Cycles And Restarts

**Files:**
- Modify: `apps/api/src/runtime/live_read_model.ts`
- Modify: `apps/api/src/runtime/postgres_signal_store.ts`
- Create: `apps/api/tests/connector-state-hydration.test.ts`
- Create: `apps/api/tests/connector-status-retention.test.ts`

**Steps:**
1. Add failing tests for two cases:
   - a failed daily connector should remain failed until the next daily run changes it
   - persisted connector state should be reloaded on restart
2. Change refresh status assembly so connectors not touched by the current cadence keep their prior persisted status instead of defaulting to `active`.
3. Hydrate connector state from the database during read-model startup alongside refresh timestamps.
4. Keep disabled/config-missing connectors derived from config, not stale DB rows.
5. Re-run connector-state tests plus any existing connector route tests.

**Verification:**
- `CI=1 pnpm --filter @idea/api test -- --run apps/api/tests/connector-state-hydration.test.ts apps/api/tests/connector-status-retention.test.ts`

**Commit:**
- `fix: retain and hydrate connector state correctly`

## Task 5: Isolate Research-Agent Runs By Profile

**Files:**
- Modify: `apps/api/src/runtime/thesis_store.ts`
- Modify: `apps/api/src/runtime/postgres_thesis_store.ts`
- Modify: `apps/api/src/jobs/agent_runner.ts`
- Create: `apps/api/tests/agent-runner-profile-isolation.test.ts`

**Steps:**
1. Extend thesis-store read APIs with optional profile filters while preserving current callers.
2. Add failing tests proving a `consumer` run cannot use or mutate `b2b` theses and vice versa.
3. Scope these `runResearchAgent()` stages by profile:
   - active thesis context
   - debate candidates
   - enrichment pass
   - duplicate detection if it should remain profile-local
4. Keep shared signal clustering global unless a specific product decision says otherwise.
5. Re-run agent-runner and integration suites.

**Verification:**
- `CI=1 pnpm --filter @idea/api test -- --run apps/api/tests/agent-runner.test.ts apps/api/tests/agent-runner-profile-isolation.test.ts apps/api/tests/v2-integration.test.ts`

**Commit:**
- `fix: isolate research-agent thesis operations by profile`

## Task 6: Fix Provider Retry Semantics Without Reintroducing Dual-Analyst Bugs

**Files:**
- Modify: `packages/ai-runtime/src/dual_analyst.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `packages/ai-runtime/tests/dual-analyst.test.ts`

**Steps:**
1. Add failing tests for `AI_RETRIES=0`, `AI_RETRIES=1`, and `AI_RETRIES>1`.
2. Thread the retry budget from runtime env into the provider execution helper.
3. Make retry behavior explicit:
   - primary provider first
   - optional fallback
   - bounded retries according to env
4. Keep `ai_provider` logging terminology and preserve single-provider plus fallback semantics when debate is disabled.
5. Re-run all provider/runtime tests.

**Verification:**
- `CI=1 pnpm --filter @idea/ai-runtime test`
- `CI=1 pnpm --filter @idea/api test -- --run apps/api/tests/agent-runner.test.ts apps/api/tests/v2-integration.test.ts`

**Commit:**
- `fix: honor configured ai retry budget`

## Task 7: Repair Research-Agent Prompt And Signal-Analysis Bugs

**Files:**
- Modify: `apps/api/src/jobs/research_agent.ts`
- Modify: `apps/api/src/jobs/agent_runner.ts`
- Create: `apps/api/tests/research-agent-prompt.test.ts`
- Create: `apps/api/tests/agent-runner-metrics.test.ts`

**Steps:**
1. Add a failing prompt test proving the B2B broad-scan prompt does not require consumer/social opportunities.
2. Remove the hardcoded consumer requirement from shared prompt text and let profile instructions drive idea class.
3. Replace the dead `topic: 'general', source: 'all'` trend-window query with real trend data relevant to the clusters being analyzed.
4. Fix the supply-side classification so `yc_companies` and other funded-company signals are actually counted.
5. Add tests around trend summary payload shape and supply classification.

**Verification:**
- `CI=1 pnpm --filter @idea/api test -- --run apps/api/tests/research-agent-prompt.test.ts apps/api/tests/agent-runner-metrics.test.ts apps/api/tests/agent-runner.test.ts`

**Commit:**
- `fix: align research-agent prompts and market signals with profile intent`

## Task 8: Make In-Memory API Fallbacks Match Production Semantics

**Files:**
- Modify: `apps/api/src/routes/feed.ts`
- Modify: `apps/api/src/routes/theses.ts`
- Modify: `apps/api/tests/fallback-routes.test.ts`

**Steps:**
1. Keep the existing DB-backed path unchanged.
2. Implement the same query semantics in the in-memory path:
   - `/v1/signals`: `window`, `source`, `thesis_key`, `sort`, paging
   - `/v1/theses`: `page`, `sort`, `profile`, `label`, status
3. Reuse existing helper logic where possible so production and fallback code paths do not drift again.
4. Re-run fallback route tests and existing route suites.

**Verification:**
- `CI=1 pnpm --filter @idea/api test -- --run apps/api/tests/fallback-routes.test.ts`

**Commit:**
- `fix: make in-memory routes honor production query semantics`

## Task 9: Correct Explain Semantics For Non-Consumer Profiles

**Files:**
- Modify: `apps/api/src/routes/thesis_explain.ts`
- Modify: `apps/web/src/components/ThesisExplainTab.tsx`
- Modify: `packages/contracts/src/api.ts`
- Create: `apps/api/tests/thesis-explain.test.ts`
- Create: `apps/web/tests/thesis-explain-tab.test.tsx`

**Steps:**
1. Add failing tests for B2B explain rendering so the labels and values match the B2B profile dimensions.
2. Extend the explain payload so it carries dimension labels from the active profile instead of forcing consumer naming.
3. Fix `topEvidence.source` to represent the actual source, or rename the field if the payload is really relation-based.
4. Keep backward compatibility explicit:
   - either additive contract change
   - or coordinated API and UI update in the same PR
5. Re-run explain route and modal/tab tests.

**Verification:**
- `CI=1 pnpm --filter @idea/api test -- --run apps/api/tests/thesis-explain.test.ts`
- `CI=1 pnpm --filter @idea/web test -- --run apps/web/tests/thesis-explain-tab.test.tsx`

**Commit:**
- `fix: make thesis explain output match active profile semantics`

## Task 10: Harden Startup, Catch-Up, And Shutdown Behavior

**Files:**
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/routes/agent_status.ts`
- Create: `apps/api/tests/agent-startup-shutdown.test.ts`

**Steps:**
1. Add failing tests for:
   - restart catch-up should key off the latest attempt status, not only last success
   - shutdown timeout must fail the active DB run explicitly
   - `lastRun.timestamp` must represent the same event before and after restart hydration
2. Change catch-up scheduling to use `lastAttempt` and status-aware logic so a recent failure does not trigger a retry storm on every restart.
3. Make `lastRun.timestamp` consistent between in-memory completion state and startup reconstruction, using one semantic event time everywhere.
4. On shutdown timeout, mark any active `agent_runs` row failed before exit.
5. Keep the websocket terminal-state contract intact.
6. Re-run startup/shutdown and agent-status suites.

**Verification:**
- `CI=1 pnpm --filter @idea/api test -- --run apps/api/tests/agent-startup-shutdown.test.ts apps/api/tests/agent-status-route.test.ts`

**Commit:**
- `fix: harden agent startup and shutdown lifecycle`

## Task 11: Fix Small UI Truthfulness Bugs

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Create: `apps/web/tests/sidebar-state.test.tsx`

**Steps:**
1. Replace `||`-based signal-count fallback with nullish/explicit checks so a real zero stays zero.
2. Stop discarding websocket thesis stats when `total === 0`; always sync the latest server value.
3. Add focused UI tests for zero-count and zero-thesis transitions.
4. Re-run app/sidebar tests.

**Verification:**
- `CI=1 pnpm --filter @idea/web test -- --run apps/web/tests/app.test.tsx apps/web/tests/sidebar-state.test.tsx`

**Commit:**
- `fix: keep sidebar counts truthful at zero`

## Task 12: Final Regression And Merge Gate

**Files:**
- No product changes expected

**Steps:**
1. Run the focused suites from all previous tasks.
2. Run full package tests:
   - `@idea/api`
   - `@idea/web`
   - `@idea/ai-runtime`
3. Run web build.
4. Run lint only if the repo-wide baseline is clean enough to be meaningful; otherwise record the known unrelated failures separately.
5. Do a manual smoke pass:
   - websocket connects to configured backend
   - manual agent run transitions running -> terminal state
   - connectors show pending before first refresh, then real counts/statuses after refresh
   - B2B explain tab shows B2B dimensions
6. Merge only after each PR slice is green and reviewed.

**Verification:**
- `CI=1 pnpm --filter @idea/ai-runtime test`
- `CI=1 pnpm --filter @idea/api test`
- `CI=1 pnpm --filter @idea/web test`
- `pnpm --filter @idea/web build`

**Commit:**
- No final catch-all commit; keep the prior PR-sliced commits.

## Execution Notes

- Start with Task 1 and Task 2 before touching any agent logic. If websocket transport is still ambiguous, the rest of the UI validations will be noisy.
- Do not combine Task 5, Task 7, and Task 10 in one PR. Those all affect research-agent behavior and should be isolated for easier rollback.
- Task 8 should land before any future local-mode debugging; otherwise test and dev environments will continue to disagree with production.
- Task 9 should land with coordinated API and UI updates in one branch to avoid temporary contract drift.

## Suggested Ownership

- Workstream A: Tasks 1-4, 11
- Workstream B: Tasks 5-7, 10
- Workstream C: Tasks 8-9, 12

## Success Criteria

- WebSocket and REST both connect to the configured backend origin.
- Connector countdowns and statuses represent real scheduler state.
- Research-agent runs are profile-isolated and honor configured retry behavior.
- In-memory fallback APIs behave the same way as DB-backed production paths.
- Explain surfaces are truthful for both consumer and B2B profiles.
- Restart/shutdown behavior does not create retry storms or stranded running rows.
- Zero counts and empty states render accurately in the UI.
