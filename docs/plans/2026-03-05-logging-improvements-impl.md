# Logging Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add AI observability logging (deep-dive generation, prompt visibility, manual triggers) and replace raw JSON log context with human-readable key=value formatting on the frontend.

**Architecture:** Three independent changes: (1) frontend formatting function rewrite, (2) deep-dive generator + route logging, (3) connector refresh trigger logging. All use the existing `ExecutionLogger` infrastructure and JSONL persistence. No new dependencies.

**Tech Stack:** TypeScript, React (frontend formatting), Fastify (API routes), existing `ExecutionLogger`

---

### Task 1: Frontend — key=value log formatting

**Files:**
- Modify: `apps/web/src/App.tsx:39-57` (formatLogContext, formatTerminalLine)

**Step 1: Write the `formatLogContext` replacement**

Replace the current `formatLogContext` and `formatTerminalLine` functions in `apps/web/src/App.tsx` (lines 39-57) with:

```typescript
const formatContextValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 197)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length <= 3) return value.map(formatContextValue).join(', ');
    return `[${value.length} items]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length <= 3) return entries.map(([k, v]) => `${k}=${formatContextValue(v)}`).join(', ');
    return `{${entries.length} fields}`;
  }
  return String(value);
};

const formatLogContext = (context: Record<string, unknown> | undefined): string => {
  if (!context || Object.keys(context).length === 0) return '';

  const entries = Object.entries(context);
  const maxKeyLen = Math.max(...entries.map(([k]) => k.length));

  return entries
    .map(([key, value]) => `    ${key.padEnd(maxKeyLen)} = ${formatContextValue(value)}`)
    .join('\n');
};

const formatTerminalLine = (entry: ExecutionLogRecord): string => {
  const timestamp = new Date(entry.ts).toLocaleTimeString();
  const context = formatLogContext(entry.context);
  const suffix = context ? `\n${context}` : '';
  return `[${timestamp}] [${entry.level.toUpperCase()}] [${entry.component}] ${entry.message}${suffix}`;
};
```

Key changes from current code:
- Context values rendered as `key = value` pairs, one per line, indented 4 spaces
- Keys right-padded so `=` signs align
- `run_id` removed from the header line (redundant noise)
- Nested objects flattened; arrays summarized if >3 items
- Values truncated at 200 chars

**Step 2: Verify the build**

Run: `pnpm --filter @idea/web run build`
Expected: Build succeeds, no type errors.

**Step 3: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat: format log context as key=value pairs instead of raw JSON"
```

---

### Task 2: Deep-dive generator — add logging

**Files:**
- Modify: `apps/api/src/jobs/deep_dive_generator.ts:18-22,90-121` (add logger to deps, log around AI calls)
- Modify: `apps/api/src/routes/theses.ts:10-15,132-169` (pass logger, log cache hits)
- Modify: `apps/api/src/main.ts:145-150` (wire logger into deps)

**Step 1: Add logger to `DeepDiveGeneratorDeps`**

In `apps/api/src/jobs/deep_dive_generator.ts`, add `logger` to the deps type (line 18-22):

```typescript
import type { ExecutionLogger } from '../runtime/execution_logger';

export type DeepDiveGeneratorDeps = {
  runClaude: (input: RunPromptInput) => Promise<RunPromptResult>;
  runCodex: (input: RunPromptInput) => Promise<RunPromptResult>;
  preferredProvider?: 'claude' | 'codex';
  logger?: Pick<ExecutionLogger, 'info' | 'debug' | 'error'>;
};
```

**Step 2: Add logging to `generateDeepDive` function**

Replace the `generateDeepDive` function body (lines 90-121) with:

```typescript
export const generateDeepDive = async (
  input: DeepDiveInput,
  deps: DeepDiveGeneratorDeps
): Promise<{ result: DeepDiveResult; provider: string }> => {
  const { runClaude, runCodex, preferredProvider = 'claude', logger } = deps;
  const prompt = buildPrompt(input);
  const promptInput: RunPromptInput = { prompt, timeoutMs: TIMEOUT_MS };
  const log = logger ?? { info: async () => {}, debug: async () => {}, error: async () => {} };

  const primaryRun = preferredProvider === 'codex' ? runCodex : runClaude;
  const fallbackRun = preferredProvider === 'codex' ? runClaude : runCodex;
  const primaryName = preferredProvider === 'codex' ? 'codex' : 'claude';
  const fallbackName = preferredProvider === 'codex' ? 'claude' : 'codex';

  await log.info('deep_dive', 'generating deep-dive', {
    thesis: input.title,
    provider: primaryName,
    prompt_preview: prompt.slice(0, 300)
  });

  const startMs = Date.now();

  let primaryResult: RunPromptResult;
  try {
    primaryResult = await primaryRun(promptInput);
    const parsed = parseDeepDiveJson(primaryResult.text);
    if (parsed) {
      const durationMs = Date.now() - startMs;
      await log.info('deep_dive', 'deep-dive complete', {
        thesis: input.title,
        provider: primaryResult.provider,
        duration_ms: durationMs
      });
      return { result: parsed, provider: primaryResult.provider };
    }
    await log.debug('deep_dive', 'primary parse failed, trying fallback', {
      thesis: input.title,
      provider: primaryName
    });
  } catch (err) {
    await log.debug('deep_dive', 'primary provider failed, trying fallback', {
      thesis: input.title,
      provider: primaryName,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  const fallbackResult = await fallbackRun(promptInput);
  const parsed = parseDeepDiveJson(fallbackResult.text);
  if (!parsed) {
    const durationMs = Date.now() - startMs;
    await log.error('deep_dive', 'deep-dive failed', {
      thesis: input.title,
      provider: `${primaryName}+${fallbackName}`,
      duration_ms: durationMs,
      preview: fallbackResult.text.slice(0, 200)
    });
    throw new Error(
      `deep_dive_generator: failed to parse AI response from both providers. Preview: ${fallbackResult.text.slice(0, 200)}`
    );
  }

  const durationMs = Date.now() - startMs;
  await log.info('deep_dive', 'deep-dive complete (fallback)', {
    thesis: input.title,
    provider: fallbackResult.provider,
    duration_ms: durationMs
  });
  return { result: parsed, provider: fallbackResult.provider };
};
```

**Step 3: Add logging to the deep-dive route**

In `apps/api/src/routes/theses.ts`, add `logger` to deps type (line 10-15):

```typescript
import type { ExecutionLogger } from '../runtime/execution_logger';

export type ThesesRouteDeps = {
  store: ThesisStore;
  memoryStore?: PostgresMemoryStore | null;
  deepDiveStore?: DeepDiveStore | null;
  deepDiveAi?: DeepDiveGeneratorDeps | null;
  logger?: Pick<ExecutionLogger, 'info' | 'debug' | 'error'>;
};
```

In the POST `/v1/theses/:key/deep-dive` handler (line 132-169), add logging:

After `if (cached) return cached;` (line 141), add:
```typescript
    if (cached) {
      await deps.logger?.info('deep_dive', 'deep-dive served from cache', { thesis: key });
      return cached;
    }
```

Pass the logger through to `generateDeepDive` by adding it to the AI deps (line 151-157):
```typescript
    const { result, provider } = await generateDeepDive({
      title: thesis.title,
      problemStatement: thesis.problemStatement,
      targetBuyer: thesis.targetBuyer,
      proposedSolution: thesis.proposedSolution,
      confidence: thesis.confidence,
    }, { ...deps.deepDiveAi, logger: deps.logger });
```

**Step 4: Wire logger in main.ts**

In `apps/api/src/main.ts`, the `serverDeps` object (around line 136-154) passes deps to `buildServer`. Add a persistent logger for deep-dive operations. Find the line where `deepDiveAi` is set (line 146-150) and add a logger alongside it:

```typescript
  deepDiveStore: pool ? createDeepDiveStore({ pool }) : null,
  deepDiveAi: {
    runClaude: runClaudePrompt,
    runCodex: runCodexPrompt,
    preferredProvider: resolveAiJudgeSettings(process.env).preferredProvider
  },
  deepDiveLogger: createExecutionLogger({ runId: 'deep-dive' }),
```

Then in `apps/api/src/server.ts` (or wherever `buildServer` wires the theses route), pass the logger:

Find where `registerThesesRoute` is called and add the logger to deps. The theses route deps should include:
```typescript
  logger: deps.deepDiveLogger,
```

Note: You'll need to check `apps/api/src/server.ts` to find the exact wiring location.

**Step 5: Verify the build and tests**

Run: `pnpm --filter @idea/web run build && CI=1 pnpm test`
Expected: Build succeeds, 233+ tests pass.

**Step 6: Commit**

```bash
git add apps/api/src/jobs/deep_dive_generator.ts apps/api/src/routes/theses.ts apps/api/src/main.ts apps/api/src/server.ts
git commit -m "feat: add logging to deep-dive generation with prompt preview and timing"
```

---

### Task 3: Manual refresh trigger logging

**Files:**
- Modify: `apps/api/src/routes/connectors.ts:7-14,32-42` (add logger to deps, log on POST)

**Step 1: Add logger to connector route deps and log the trigger**

In `apps/api/src/routes/connectors.ts`, add logger to deps type (line 7-14):

```typescript
import type { ExecutionLogger } from '../runtime/execution_logger';

export const registerConnectorRoute = (
  app: FastifyInstance,
  deps: {
    listConnectors: () => Promise<ConnectorStatusRecord[]>;
    memoryStore?: PostgresMemoryStore | null;
    getRefreshMeta?: () => RefreshMeta;
    triggerRefresh?: (cadence?: 'hourly' | 'daily') => Promise<void>;
    logger?: Pick<ExecutionLogger, 'info'>;
  }
): void => {
```

In the POST handler (line 32-42), add a log call before triggering:

```typescript
  }, async (request) => {
    if (!deps.triggerRefresh) {
      return { status: 'unavailable' };
    }
    const cadence = request.query.cadence as 'hourly' | 'daily' | undefined;
    const connectors = await deps.listConnectors();
    const count = cadence
      ? connectors.filter((c) => c.cadence === cadence).length
      : connectors.filter((c) => c.status === 'active').length;
    await deps.logger?.info('connectors', 'manual refresh triggered', {
      cadence: cadence ?? 'all',
      connector_count: count
    });
    void deps.triggerRefresh(cadence);
    return { status: 'triggered' };
  });
```

**Step 2: Wire logger in server.ts**

Find where `registerConnectorRoute` is called in `apps/api/src/server.ts` and pass the logger. Use the same persistent logger or create one:

```typescript
  logger: deps.deepDiveLogger, // reuse the same persistent logger
```

**Step 3: Verify the build and tests**

Run: `pnpm --filter @idea/web run build && CI=1 pnpm test`
Expected: Build succeeds, all tests pass.

**Step 4: Commit**

```bash
git add apps/api/src/routes/connectors.ts apps/api/src/server.ts
git commit -m "feat: log manual connector refresh triggers"
```

---

### Task 4: Agent runner — add prompt preview logging

**Files:**
- Modify: `apps/api/src/jobs/agent_runner.ts:177-192,322-335` (add prompt preview to existing log calls)

**Step 1: Add prompt preview to broad scan log**

In `agent_runner.ts`, after line 179 (`const broadPrompt = buildBroadScanPrompt(broadCtx);`), update the existing log at line 177 to include the prompt preview:

Replace:
```typescript
  await log.info('agent_runner', 'broad scan started', { cluster_count: clusters.length });
```

With:
```typescript
  await log.info('agent_runner', 'broad scan started', {
    cluster_count: clusters.length,
    thesis_count: activeTheses.length,
    signal_count: recentSignals.length
  });
```

After line 179 (after `buildBroadScanPrompt`), add:
```typescript
  await log.debug('agent_runner', 'broad scan prompt sent', {
    provider: preferred,
    prompt_length: broadPrompt.length,
    prompt_preview: broadPrompt.slice(0, 300)
  });
```

**Step 2: Add prompt preview to deep dive log**

In `agent_runner.ts`, after line 322 (`const divePrompt = buildDeepDivePrompt(diveCtx);`), add:

```typescript
  await log.debug('agent_runner', 'deep dive prompt sent', {
    topic: dig.topic,
    provider: preferred,
    prompt_length: divePrompt.length,
    prompt_preview: divePrompt.slice(0, 300)
  });
```

**Step 3: Verify the build and tests**

Run: `CI=1 pnpm test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add apps/api/src/jobs/agent_runner.ts
git commit -m "feat: add prompt preview logging to agent runner broad scan and deep dives"
```
