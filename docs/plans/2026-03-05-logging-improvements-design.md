# Logging Improvements — AI Observability & Human-Readable Formatting

## Goal

Make the logging system useful for understanding how the AI system works: what prompts are sent, which providers respond, timing, and operational state. Replace raw JSON context with human-readable key=value formatting.

## Architecture

Add logging to currently-silent AI operations (deep-dive generation, AI prompt details, manual triggers). Reformat frontend log context from raw JSON to indented key=value pairs. No changes to log persistence (JSONL files) or streaming (SSE).

## A. New Log Sources

### 1. Deep-Dive Generation (`deep_dive` component)

| Level | Message | Context Fields |
|-------|---------|---------------|
| info | generating deep-dive | thesis, provider |
| info | deep-dive complete | thesis, provider, duration_ms |
| info | deep-dive served from cache | thesis |
| error | deep-dive failed | thesis, provider, error |

**File:** `apps/api/src/jobs/deep_dive_generator.ts` — accept logger parameter, add log calls around AI provider calls.

### 2. AI Prompt Visibility (existing components)

Add `debug`-level prompt logging to:
- `agent_runner.ts` — log prompt preview sent to research agent
- `ai_post_scrape.ts` — log prompt preview for batch signal enrichment
- `ai_judges.ts` — log prompt preview for buildability judging

| Level | Message | Context Fields |
|-------|---------|---------------|
| debug | prompt sent | provider, prompt_preview (first 300 chars), signal_count |
| info | AI response received | provider, duration_ms, result_summary |

### 3. Manual Refresh Triggers (`connectors` component)

| Level | Message | Context Fields |
|-------|---------|---------------|
| info | manual refresh triggered | cadence, connector_count |

**File:** `apps/api/src/routes/connectors.ts` — log on POST `/v1/connectors/refresh`.

## B. Frontend Log Formatting

### Current (raw JSON)
```
[17:14:07] [ERROR] [ingest_open] run=abc connector failed
{
  "connector": "alternativeto",
  "cadence": "daily",
  "error": "AlternativeTo RSS failed: 403"
}
```

### New (key=value)
```
[17:14:07] ✖ [ingest_open] connector failed
    connector = alternativeto
    cadence   = daily
    error     = AlternativeTo RSS failed: 403
```

### Formatting Rules
- Each context key on its own line, indented 4 spaces
- Keys right-padded to align `=` signs
- Values rendered as plain strings (no quotes unless the value contains spaces AND is multi-word)
- Nested objects: flatten with dot notation (`result.theses = 3`)
- Arrays: join with `, ` if short, otherwise count (`signals = [12 items]`)
- Drop `run_id` from context display (already shown in the header line)
- Truncate values longer than 200 chars with `...`

### Header Line Simplification
Remove `run=` prefix from header to reduce noise. Keep level icon + component + message only:
```
[17:14:07] ✖ [ingest_open] connector failed
```

## C. What Stays The Same
- JSONL file persistence format (no change)
- SSE streaming protocol (no change)
- Log levels: debug/info/warn/error
- No UI click/navigation logging
- Session scope filtering
