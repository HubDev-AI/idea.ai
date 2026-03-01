# V1 Stabilization Design

## Goal

Fix all known bugs, remove dead code, and fill test coverage gaps before starting v2 planning. This is a full audit-driven cleanup across API, frontend, and shared packages.

## Audit Methodology

Three parallel audits covering:
- **API**: routes, runtime modules, jobs, migrations, main.ts, tests
- **Frontend**: App.tsx, components, api.ts, tests, build config
- **Packages**: contracts, ai-runtime, pipeline, connectors, root config

## Findings Summary

- 8 critical bugs (affect correctness/functionality)
- 12 medium bugs (affect reliability/performance/maintainability)
- 6+ dead code items
- 8+ test coverage gaps

## Delivery: 4 PRs

### PR 1: Critical Bug Fixes

| # | Issue | Files |
|---|-------|-------|
| 1.1 | Historical signals show `signal_id` instead of text in deep dive prompt — AI reads opaque IDs | `contracts/memory.ts`, `postgres_memory_store.ts`, `agent_runner.ts` |
| 1.2 | AI judging disabled: `defaultMaxSignals = isTest ? 0 : 0` — both branches are 0 | `ai_judges.ts` |
| 1.3 | Shutdown doesn't await in-flight agent run — DB row stuck in 'running', partial state | `main.ts` |
| 1.4 | `avgPain/avgTiming/avgBuildability` always 0 from Postgres — hardcoded, not from DB | `postgres_thesis_store.ts` |
| 1.5 | `reddit` + `producthunt` excluded from `OPEN_CONNECTORS` — configured but never run | `live_read_model.ts` |
| 1.6 | No React error boundary — render crash = blank white screen | `main.tsx` or new `ErrorBoundary.tsx` |
| 1.7 | `routeNextQueue` drops fan-out routes — returns first queue only | `pipeline/worker.ts` |
| 1.8 | Dual runId — `agent_runner.ts` and `main.ts` generate different IDs for same run | `main.ts`, `agent_runner.ts` |

### PR 2: Medium Bug Fixes

| # | Issue | Files |
|---|-------|-------|
| 2.1 | Embedding mismatch: query uses local hash, store has Ollama vectors | `postgres_memory_store.ts`, `agent_runner.ts` |
| 2.2 | Double pg.Pool — `live_read_model` + `main.ts` create separate pools | `main.ts` |
| 2.3 | No data retention — tables and log files grow unbounded | New migration, `main.ts` |
| 2.4 | Journal store pool leak — never closed in shutdown | `main.ts` |
| 2.5 | Thesis page change triggers full 7-endpoint refresh | `App.tsx` |
| 2.6 | `AgentRunResult` type duplicated between API and web | `contracts/api.ts`, `agent_runner.ts`, `api.ts` |
| 2.7 | Retry hardcoded to Claude only — no Codex fallback | `dual_analyst.ts` |
| 2.8 | GitHub connector unauthenticated — 10 req/min rate limit | `github_issues.ts` |
| 2.9 | Legacy `fetchTheses` union return type — duplicate guards at call sites | `api.ts`, `App.tsx` |
| 2.10 | HNSW index on nullable embedding — should be partial index | New migration |
| 2.11 | `loadWarning` never clears after recovery | `App.tsx` |
| 2.12 | Thesis pagination not gated on `isLoading` | `App.tsx` |

### PR 3: Dead Code Cleanup

| Item | Reason |
|------|--------|
| `AiHealthPanel.tsx` | Never imported |
| `ConnectorStatus.tsx` | Never imported |
| `StatusCards.tsx` | Never imported |
| `idea.ts` | Never called, drifted from API version |
| `bootstrap/queues.ts` | Redis queue infra never invoked |
| `scheduler.ts` | Never called from main.ts |
| Legacy `buildAgentPrompt`/`parseAgentResponse` | Kept for old tests but new format is canonical |
| Dead schema references | `thesis_snapshots`, `synthesis_runs` comments |

### PR 4: Test Coverage

| Test | Target |
|------|--------|
| Agent run trigger flow | `handleRunAgent` in App.tsx |
| Log drawer interaction | Open/close, scroll, badge |
| SSE streaming endpoint | `/v1/logs/stream` |
| `GET /v1/theses/:key` happy path | Thesis detail route |
| `POST /v1/theses/synthesize` | Synthesis endpoint |
| `GET /v1/infra/status` | Infrastructure status route |
| ThesisCard edge cases | isActive, onClick, scope, confidence |
| SignalRow expand/collapse | Reasoning, breakdown chips |

## Verification

1. `pnpm exec vitest run` passes after each PR
2. `pnpm exec tsc --noEmit` has no new errors
3. App loads in browser, agent run completes successfully
4. All new tests pass with meaningful assertions
