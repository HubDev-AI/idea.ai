# Research Agent Wiring Design

**Date:** 2026-02-27
**Status:** Approved

## Problem

`runResearchAgent` in `apps/api/src/jobs/agent_runner.ts` is fully implemented and tested but never called. The web UI fetches `GET /v1/agent/status` which doesn't exist. The TOP IDEAS pane and RESEARCH AGENT status card remain empty.

## Decision

Wire the research agent via a croner job in `main.ts` on a 30-minute cadence, with a manual trigger endpoint and UI button.

### Why croner in main.ts (not live_read_model)

- The signal refresh runs every 5 minutes — too frequent for the research agent which calls dual AI providers (claude+codex) with a 60s timeout each.
- `main.ts` already has `thesisStore`, `memoryStore`, and is the natural place for process-level scheduling.
- Clean separation: `live_read_model` owns signal refresh, `main.ts` owns research agent scheduling.

## Design

### 1. Shared agent status ref

```typescript
// in main.ts
let agentStatus: AgentStatusRecord = { lastRun: null, investigateNext: null };
```

Updated by both the cron job and the manual trigger endpoint.

### 2. Croner job in main.ts

```
Cron('*/30 * * * *', async () => {
  const result = await runResearchAgent({ thesisStore, memoryStore, runClaude, runCodex });
  agentStatus = { lastRun: { timestamp, thesesUpdated, newCandidates }, investigateNext };
});
```

Dependencies: `runClaudePrompt` and `runCodexPrompt` from `@idea/ai-runtime`, `thesisStore`, `memoryStore` — all already available in `main.ts` scope.

### 3. API routes

- `GET /v1/agent/status` — returns current `agentStatus` (in-memory).
- `POST /v1/agent/run` — manual trigger. Calls `runResearchAgent`, updates `agentStatus`, returns result. Rate-limited to 2/min.

New file: `apps/api/src/routes/agent_status.ts` (same pattern as `ai_health.ts`).

### 4. Server plumbing

Add to `ServerDeps`:
- `getAgentStatus: () => Promise<AgentStatusRecord>`
- `triggerAgentRun: () => Promise<AgentRunResult>`

### 5. UI button

Add a "Run" button to the RESEARCH AGENT status card in `StatusCards.tsx`. Calls `POST /v1/agent/run`, shows loading state, refreshes status on completion.

Add `triggerAgentRun()` to `apps/web/src/api.ts`.

## Files

| File | Change |
|------|--------|
| `apps/api/src/main.ts` | Croner job, shared status ref, wire deps |
| `apps/api/src/routes/agent_status.ts` | New: GET status + POST run routes |
| `apps/api/src/server.ts` | Add `getAgentStatus` + `triggerAgentRun` to ServerDeps |
| `apps/web/src/components/StatusCards.tsx` | Add "Run" button to research agent card |
| `apps/web/src/api.ts` | Add `triggerAgentRun()` function |

## Not in scope

- Persisting agent run history to DB (in-memory is sufficient for now)
- Configurable cadence via env var (can add later if needed)
