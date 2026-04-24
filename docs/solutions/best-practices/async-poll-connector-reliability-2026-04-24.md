---
title: Reliability hardening for async POST→poll→fetch API connectors
date: 2026-04-24
category: docs/solutions/best-practices
module: BYO Connectors
problem_type: best_practice
component: tooling
severity: high
applies_when:
  - Building a connector that POSTs tasks to an external API and polls for results
  - Any connector with a long-running async poll loop (DataForSEO, Apify, batch AI APIs)
  - Wrapping an external API client in a custom fetch to inject auth headers
tags:
  - connectors
  - async
  - polling
  - reliability
  - abort-controller
  - error-handling
  - security
  - dataforseo
---

# Reliability hardening for async POST→poll→fetch API connectors

## Context

The DataForSEO SERP BYO connector (`packages/connectors/src/dataforseo_serp_byo.ts`) implements the standard async queued-API pattern: POST tasks → poll tasks_ready → fetch each result. A code review caught 3 P1 reliability gaps and 2 security issues that are easy to miss but cause hard-to-diagnose production failures:

- A single transient network error on the poll endpoint crashes the entire run, losing all already-queued tasks
- A chunk POST failure silently aborts all remaining chunks in the batch
- No HTTP timeout means a hung connection holds the scheduler indefinitely
- Authorization header CRLF injection via env var not stripped
- Extracted third-party content passed unbounded to LLM prompts

These are not DataForSEO-specific. They recur in any connector using this pattern.

## Guidance

**1. Wrap the poll endpoint in `.catch` to survive transient errors**

The `tasks_ready` / poll endpoint sits inside the outer while loop. A thrown error here exits the loop entirely, abandoning all submitted tasks. Use `.catch` returning `null` to skip the cycle and retry:

```typescript
// Before — one network error exits the poll loop
const readyRes = await api.googleOrganicTasksReady();
const readyItems = readyRes.tasks?.[0]?.result ?? [];

// After — transient error skips this cycle, retries next iteration
const readyRes = await api.googleOrganicTasksReady().catch((err: unknown) => {
  console.error('[connector] tasks_ready poll failed:', err instanceof Error ? err.message : String(err));
  return null;
});
if (!readyRes) continue;
const readyItems = readyRes.tasks?.[0]?.result ?? [];
```

**2. Wrap each chunk POST in try/catch to skip failed chunks**

Without error isolation, one failed chunk aborts the entire batch. Wrap the POST body only — keep the task-ID registration inside the try so you never register IDs from a failed POST:

```typescript
for (const chunk of chunks) {
  const tasks = chunk.map(buildTaskRequest);
  try {
    const res = await api.taskPost(tasks);
    const taskList = res.tasks ?? [];
    for (let i = 0; i < taskList.length; i++) {
      if (taskList[i]?.id && chunk[i]) taskIdToQuery.set(taskList[i].id, chunk[i]);
    }
  } catch (err) {
    console.error(`[connector] chunk POST failed (${chunk.length} tasks):`, err instanceof Error ? err.message : String(err));
  }
}
```

**3. Add per-request AbortController timeout to the injected fetch wrapper**

External API clients that accept a custom `fetch` option give you a seam to add timeouts without modifying the client. Create a new `AbortController` per request, not one shared across the connector lifetime:

```typescript
const fetchTimeoutMs = Math.max(5_000, parseInt(env.CONNECTOR_FETCH_TIMEOUT_MS ?? '30000', 10));
const api = new ExternalApi(baseUrl, {
  fetch: (url: RequestInfo, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
    return fetchImpl(url as string, {
      ...init,
      signal: controller.signal,
      headers: { ...(init?.headers ?? {}), Authorization: `Basic ${apiKey}` },
    }).finally(() => clearTimeout(timer));
  },
});
```

**4. Strip CRLF from Authorization header values**

If the API key comes from an env var, CRLF characters (`\r\n`) in the value inject extra HTTP headers. Strip before encoding:

```typescript
Authorization: `Basic ${apiKey.replace(/[\r\n]/g, '')}`,
```

**5. Cap extracted third-party content before passing to LLMs**

SERP content, PAA snippets, and AI overviews come from attacker-controlled sources. Cap at the extraction boundary, not at the prompt boundary:

```typescript
const title = String(organic.title ?? '').slice(0, 500);
const snippet = String(organic.description ?? '').slice(0, 1000);
const aioText = text.slice(0, 4096) || null;        // AI overview: 4 KB
const question = String(e.title ?? '').slice(0, 200); // PAA question
const paaSnippet = String(e.description ?? '').slice(0, 500);
```

## Why This Matters

The poll-loop pattern is deceptively simple to write but fragile in production:

- **Uncaught poll error** → scheduler silently skips all submitted tasks until the next scheduled run
- **Uncaught chunk POST error** → partial batch with no signal; upstream budget tracking records partial spend against zero results
- **No timeout** → one hung connection blocks the scheduler thread for the full 10-minute ceiling, delaying all other connectors
- **CRLF in auth header** → security vulnerability; base64 header contains `login:password` in plaintext, log-scraping is trivially easy if the full header is ever emitted
- **Unbounded LLM content** → prompt injection from attacker-crafted SERP titles/snippets; cap at ingest, not at prompt assembly

## When to Apply

- Any connector using a `task_post` → poll → `task_get` pattern (DataForSEO, Apify, Diffbot, batch AI inference APIs)
- Any connector that wraps an external SDK's `fetch` option to inject auth
- Any connector that routes third-party text content into LLM prompts
- Before shipping a new BYO connector — apply all 5 points as a pre-ship checklist

## Examples

The full implementation with all 5 patterns applied lives in:
`packages/connectors/src/dataforseo_serp_byo.ts`

Key lines:
- `fetchTimeoutMs` + AbortController wrapper: lines 131–146
- Chunk POST try/catch: lines 162–172
- `googleOrganicTasksReady().catch(...)`: lines 186–191
- CRLF strip: line 139
- Content caps: lines 58, 69–70, 217–218

## Related

- PR #113: feat(connectors): add SERP connector and language-first pruning gate — https://github.com/HubDev-AI/idea.ai/pull/113
- Code review run artifact: `.context/compound-engineering/ce-code-review/20260424-122853-aa475c83/`
