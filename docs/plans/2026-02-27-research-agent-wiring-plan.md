# Research Agent Wiring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the existing `runResearchAgent` to run on a 30-min interval and expose its status via API + manual trigger button in the UI.

**Architecture:** A `setInterval` in `main.ts` calls `runResearchAgent` every 30 minutes. An in-memory `AgentStatusRecord` ref is shared between the timer and a new route file. `GET /v1/agent/status` returns current status, `POST /v1/agent/run` triggers immediately. The UI adds a "Run" button to the existing Research Agent status card.

**Tech Stack:** Fastify routes, existing `runResearchAgent`/`dualAnalystRun`, React `StatusCards.tsx`

---

### Task 1: Create the agent status route file

**Files:**
- Create: `apps/api/src/routes/agent_status.ts`

**Step 1: Create route file**

Follow the exact pattern of `apps/api/src/routes/ai_health.ts`. Two routes:
- `GET /v1/agent/status` — returns the current `AgentStatusRecord`
- `POST /v1/agent/run` — calls `triggerRun()`, returns result. Rate-limited to 2/min.

```typescript
import type { AgentStatusRecord } from '@idea/contracts/src/api';
import type { FastifyInstance } from 'fastify';
import type { AgentRunResult } from '../jobs/agent_runner';

export type AgentStatusDeps = {
  getAgentStatus: () => AgentStatusRecord;
  triggerRun: () => Promise<AgentRunResult>;
};

export const registerAgentStatusRoute = (
  app: FastifyInstance,
  deps: AgentStatusDeps
): void => {
  app.get('/v1/agent/status', async () => deps.getAgentStatus());

  app.post('/v1/agent/run', {
    config: { rateLimit: { max: 2, timeWindow: '1 minute' } }
  }, async () => {
    const result = await deps.triggerRun();
    return result;
  });
};
```

**Step 2: Verify no TypeScript errors**

Run: `cd apps/api && npx tsc --noEmit 2>&1 | grep agent_status`
Expected: No errors for this file.

**Step 3: Commit**

```
git add apps/api/src/routes/agent_status.ts
git commit -m "feat: add GET /v1/agent/status and POST /v1/agent/run routes"
```

---

### Task 2: Wire route into server.ts

**Files:**
- Modify: `apps/api/src/server.ts`

**Step 1: Add imports and deps**

At the top of `server.ts`, add the import:
```typescript
import { type AgentStatusDeps, registerAgentStatusRoute } from './routes/agent_status';
```

Add to `ServerDeps` type (after `getAiHealth`):
```typescript
getAgentStatus?: AgentStatusDeps['getAgentStatus'];
triggerAgentRun?: AgentStatusDeps['triggerRun'];
```

**Step 2: Register the route in buildServer**

After the `registerHealthRoute(app)` call (line 117), add:
```typescript
if (resolvedDeps.getAgentStatus && resolvedDeps.triggerAgentRun) {
  registerAgentStatusRoute(app, {
    getAgentStatus: resolvedDeps.getAgentStatus,
    triggerRun: resolvedDeps.triggerAgentRun
  });
}
```

**Step 3: Verify no TypeScript errors**

Run: `cd apps/api && npx tsc --noEmit 2>&1 | grep server.ts`
Expected: No errors.

**Step 4: Commit**

```
git add apps/api/src/server.ts
git commit -m "feat: wire agent status route into server deps"
```

---

### Task 3: Add 30-min timer and agent deps in main.ts

**Files:**
- Modify: `apps/api/src/main.ts`

**Step 1: Add imports**

```typescript
import type { AgentStatusRecord } from '@idea/contracts/src/api';
import { runClaudePrompt } from '@idea/ai-runtime/src/claude';
import { runCodexPrompt } from '@idea/ai-runtime/src/codex';
import { type AgentRunResult, runResearchAgent } from './jobs/agent_runner';
```

**Step 2: Add shared state and run function after `memoryStore` declaration (line 27)**

```typescript
let agentStatus: AgentStatusRecord = { lastRun: null, investigateNext: null };
let agentRunInFlight: Promise<AgentRunResult> | null = null;

const executeAgentRun = async (): Promise<AgentRunResult> => {
  if (agentRunInFlight) return agentRunInFlight;

  agentRunInFlight = runResearchAgent({
    thesisStore,
    memoryStore,
    runClaude: runClaudePrompt,
    runCodex: runCodexPrompt
  }).finally(() => {
    agentRunInFlight = null;
  });

  const result = await agentRunInFlight;
  agentStatus = {
    lastRun: {
      timestamp: new Date().toISOString(),
      thesesUpdated: result.thesesUpdated,
      newCandidates: result.newCandidates
    },
    investigateNext: result.investigateNext || null
  };
  return result;
};
```

**Step 3: Wire into serverDeps (after line 36)**

Add to the `serverDeps` object:
```typescript
getAgentStatus: () => agentStatus,
triggerAgentRun: executeAgentRun,
```

**Step 4: Add the 30-min interval after app.listen (after line 64)**

```typescript
const AGENT_INTERVAL_MS = 30 * 60 * 1000;
const agentTimer = setInterval(() => {
  void executeAgentRun().catch((err) => {
    console.error('research agent cron failed:', err);
  });
}, AGENT_INTERVAL_MS);
```

**Step 5: Clean up timer in shutdown (inside the shutdown function)**

Add before `process.exit(0)`:
```typescript
clearInterval(agentTimer);
```

**Step 6: Verify no TypeScript errors**

Run: `cd apps/api && npx tsc --noEmit 2>&1 | grep main.ts`
Expected: No errors.

**Step 7: Commit**

```
git add apps/api/src/main.ts
git commit -m "feat: wire research agent with 30-min interval and manual trigger"
```

---

### Task 4: Add triggerAgentRun to web API client

**Files:**
- Modify: `apps/web/src/api.ts`

**Step 1: Add the fetch function**

After `fetchAgentStatus` (line 115), add:
```typescript
export const triggerAgentRun = async (): Promise<AgentRunResult> => {
  const response = await fetch(buildApiUrl('/v1/agent/run'), { method: 'POST' });
  if (!response.ok) throw new Error('Failed to trigger agent run');
  return response.json() as Promise<AgentRunResult>;
};
```

Also add the type near the top imports. Since `AgentRunResult` is defined in the API package (not contracts), define a minimal local type:
```typescript
export type AgentRunResult = {
  thesesUpdated: number;
  newCandidates: number;
  alerts: string[];
  investigateNext: string;
};
```

**Step 2: Commit**

```
git add apps/web/src/api.ts
git commit -m "feat: add triggerAgentRun API client function"
```

---

### Task 5: Add "Run" button to StatusCards

**Files:**
- Modify: `apps/web/src/components/StatusCards.tsx`

**Step 1: Add onRunAgent prop and button**

Update the props type to include an optional callback:
```typescript
type StatusCardsProps = {
  connectors: ConnectorRecord[];
  aiHealth: AiHealthRecord | null;
  agentStatus: AgentStatusRecord | null;
  onRunAgent?: () => void;
  agentRunning?: boolean;
};
```

Update the component signature:
```typescript
export const StatusCards: React.FC<StatusCardsProps> = ({ connectors, aiHealth, agentStatus, onRunAgent, agentRunning }) => {
```

Add a "Run" button in the Research Agent card footer. Replace the existing footer block (lines 80-82):
```tsx
<div className="status-card-footer">
  {agentStatus?.investigateNext && (
    <span>Next: {agentStatus.investigateNext}</span>
  )}
  {onRunAgent && (
    <button
      className="agent-run-btn"
      onClick={onRunAgent}
      disabled={agentRunning}
    >
      {agentRunning ? 'Running...' : 'Run'}
    </button>
  )}
</div>
```

Move the footer outside the conditional so it always renders (the button should show even with no runs yet).

**Step 2: Commit**

```
git add apps/web/src/components/StatusCards.tsx
git commit -m "feat: add Run button to research agent status card"
```

---

### Task 6: Wire the Run button in App.tsx

**Files:**
- Modify: `apps/web/src/App.tsx`

**Step 1: Add state and handler**

After the existing `agentStatus` state (around line 62), add:
```typescript
const [agentRunning, setAgentRunning] = useState(false);
```

Add a handler function inside the component:
```typescript
const handleRunAgent = async () => {
  setAgentRunning(true);
  try {
    await triggerAgentRun();
    const status = await fetchAgentStatus();
    setAgentStatus(status);
  } catch {
    // Silently fail — status card will still show old state
  } finally {
    setAgentRunning(false);
  }
};
```

Import `triggerAgentRun` from `../api`.

**Step 2: Pass props to StatusCards**

Find where `<StatusCards` is rendered (around line 294) and add the new props:
```tsx
<StatusCards
  connectors={connectors}
  aiHealth={aiHealth}
  agentStatus={agentStatus}
  onRunAgent={handleRunAgent}
  agentRunning={agentRunning}
/>
```

**Step 3: Commit**

```
git add apps/web/src/App.tsx
git commit -m "feat: wire agent Run button handler in App.tsx"
```

---

### Task 7: Add minimal CSS for the Run button

**Files:**
- Modify: `apps/web/src/index.css` (or wherever the status card styles are)

**Step 1: Find the styles file and add button styles**

Search for `.status-card-footer` in CSS files. Add:
```css
.agent-run-btn {
  background: var(--accent, #0ff);
  color: var(--bg, #0a0a0a);
  border: none;
  padding: 2px 10px;
  font-size: 0.75rem;
  font-family: inherit;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-left: auto;
}

.agent-run-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.status-card-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}
```

**Step 2: Commit**

```
git add apps/web/src/index.css
git commit -m "feat: add agent Run button styles"
```

---

### Task 8: Update Sidebar.tsx for consistency

**Files:**
- Modify: `apps/web/src/components/Sidebar.tsx`

**Step 1: Check if Sidebar also needs the Run button**

The Sidebar already renders the RESEARCH AGENT section (lines 82-100). It should pass through the same `onRunAgent` / `agentRunning` props if it renders a compact version, or skip the button for the sidebar (sidebar is narrow). Decide based on UI space — likely skip the button in sidebar since StatusCards already has it.

No changes needed if the sidebar doesn't show a Run button. Just verify it compiles.

**Step 2: Commit if changes were made**

---

### Task 9: Run tests and verify

**Step 1: Run all tests**

Run: `pnpm exec vitest run --reporter=verbose`
Expected: All 177+ tests pass. The existing `agent-runner.test.ts` tests cover `runResearchAgent` logic. The web `app.test.tsx` already mocks `/v1/agent/status`.

**Step 2: Fix any failures**

If `app.test.tsx` fails because `StatusCards` now expects new props, update the test to pass `onRunAgent` and `agentRunning` props (or make them optional which they already are with `?`).

**Step 3: Final commit**

```
git add -A
git commit -m "fix: update tests for research agent wiring"
```

---

### Task 10: Integration test (manual)

**Step 1: Start infrastructure**

```
pnpm infra:up
```

**Step 2: Start the API**

```
pnpm exec tsx apps/api/src/main.ts
```

**Step 3: Verify GET /v1/agent/status returns initial state**

```
curl -s http://localhost:3000/v1/agent/status
```
Expected: `{"lastRun":null,"investigateNext":null}`

**Step 4: Trigger a manual run**

```
curl -s -X POST http://localhost:3000/v1/agent/run
```
Expected: JSON with `thesesUpdated`, `newCandidates`, `alerts`, `investigateNext`.

**Step 5: Verify status updated**

```
curl -s http://localhost:3000/v1/agent/status
```
Expected: `lastRun` now has a timestamp and counts.

**Step 6: Check theses endpoint**

```
curl -s http://localhost:3000/v1/theses
```
Expected: Any new thesis candidates created by the agent.

**Step 7: Final squash commit**

```
git add -A
git commit -m "feat: wire research agent — 30-min cron, manual trigger, UI button"
```
