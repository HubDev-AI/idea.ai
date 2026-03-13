# BetaList Connector Design

**Date:** 2026-03-13
**Status:** Approved
**Cadence:** Daily
**Limit:** 25 signals per run

---

## Overview

Add BetaList (`betalist.com`) as a daily connector in the idea.ai signal pipeline. BetaList is a curated directory of pre-launch and beta-stage startups — earlier in the funnel than ProductHunt. It surfaces what founders are building *before* public launch, making it a leading indicator of emerging problem spaces.

---

## Architecture

### File

`packages/connectors/src/betalist.ts`

Follows the same structure as `indiehackers.ts`: an async function with an injected loader dependency for testability. The default `limit` parameter reads from `OPEN_CONNECTOR_LIMITS.betalist` (not hardcoded), consistent with `indiehackers.ts`.

### Fetch Strategy

**Phase 1 — Main page scan**
GET `https://betalist.com/` → extract startup slugs via regex on `href="/startups/([a-z0-9-]+)"` links. Deduplicate slugs within the current run using a `Set` (per-run only — cross-run deduplication is handled downstream by the pipeline's `source_item_id` dedup step). Take up to `limit` (default: 25) unique slugs.

If the main page fetch fails entirely, return `[]` — same behaviour as all other connectors.
If the main page returns a valid 200 but contains zero matching `/startups/` links (e.g. BetaList changes its HTML structure), also return `[]` without throwing.

**Phase 2 — Individual page enrichment**
For each slug, GET `https://betalist.com/startups/[slug]` to extract full description, topics, and date. Pages are fetched in batches of 5 (chunked for-loop, no new dependencies). Per-slug errors are caught and skipped — remaining slugs in the run continue unaffected.

All fetches (both phases) use:
```
User-Agent: idea.ai/1.0 (research bot)
```

On a `429 Too Many Requests` response during individual-page fetches, `withRetry` will retry with its standard backoff. If all retries for a given slug are exhausted, that slug is skipped (not a run-level failure).

### Parsing

| Target | Source | Method |
|--------|--------|--------|
| Slugs | Main page HTML | `href="/startups/([a-z0-9-]+)"` regex |
| Name | Individual page `<h1>` or `<title>` | regex, strip site suffix |
| Description | Longest `<p>` in main content, min 50 chars | regex + length filter |
| Topics | `href="/topics/([a-z0-9-]+)"` links | regex |
| Date | `<time>` tag `datetime` attribute | regex, fallback: `new Date().toISOString()` |

**Description parsing rules:**
- Select the longest `<p>` block with ≥ 50 characters
- Apply HTML entity decoding (same `decodeEntities` helper as `indiehackers.ts`)
- Strip all remaining HTML tags
- If no qualifying paragraph is found, fall back to the startup name only (so text = `${name}` without a description suffix)

---

## Signal Shape

```typescript
{
  source: 'betalist',
  source_item_id: `bl:${slug}`,          // abbreviated prefix, matches convention (ih:, ph:, altto:)
  text: [
    `${name}: ${description}`,
    topics.length > 0 ? `Topics: ${topics.join(', ')}` : null,
  ].filter(Boolean).join('\n').slice(0, 2000),
  url: `https://betalist.com/startups/${slug}`,
  source_timestamp: featuredDate,        // ISO 8601 from <time datetime="...">, fallback new Date().toISOString()
  // engagement_count: omitted — not publicly accessible without JS
}
```

The `Topics:` line is omitted entirely when no topic links are found — no dangling label.

---

## Registration Changes

Six files require updates (five data files + one new connector file):

| File | Change |
|------|--------|
| `packages/connectors/src/betalist.ts` | New file |
| `apps/api/src/jobs/ingest_open.ts` | Add `'betalist'` to `OpenConnectorName` union and `defaultLoaders` map |
| `packages/connectors/src/common/http.ts` | Add `betalist: 'daily'` (string literal, `Cadence` type) to `OPEN_CONNECTOR_CADENCE`; add `betalist: 25` to `OPEN_CONNECTOR_LIMITS` |
| `apps/api/src/runtime/live_read_model.ts` | Add `'betalist'` to `OPEN_CONNECTORS` array |
| `apps/api/src/config/env.ts` | Add `betalist` to the hardcoded `DAILY_CONNECTORS` fallback list alongside `producthunt` and `indiehackers` (opt-in by default for all users) |
| `apps/web/src/connectorNames.ts` | Add `betalist: 'BetaList'` to `connectorDisplayName` map |

---

## Error Handling

- `withRetry` wraps both the main page fetch and each individual page fetch
- Per-slug try/catch: if an individual page fetch or parse fails, that startup is skipped; run continues
- Main page failure → return `[]`
- Main page success with zero slugs → return `[]`
- `429` on individual page → `withRetry` exhausts retries, slug is skipped

---

## Testing

Five test cases following the injected-loader pattern used across all connectors:

1. **Slug extraction** — pass sample main-page HTML, assert correct slugs are extracted and deduplicated within the run
2. **Page parsing** — pass sample startup page HTML, assert name/description/topics/date are correctly extracted and entities are decoded
3. **Full function with mock loader** — inject mock that returns canned HTML for main + individual pages, assert final `RawEventInput[]` shape and field values including `bl:` prefix
4. **Main page returns zero slugs** — inject mock returning valid HTML with no `/startups/` links, assert function returns `[]` without throwing
5. **Partial individual page failure** — inject mock where 2 of 5 individual pages throw, assert the remaining 3 signals are still returned correctly

---

## What It Adds to the Pipeline

BetaList complements existing connectors:

| Connector | Stage | Signal type |
|-----------|-------|-------------|
| ProductHunt | Post-launch | Traction + community validation |
| IndieHackers | Post-launch | Founder revenue/growth stories |
| **BetaList** | **Pre-launch** | **Founder intent + emerging problem spaces** |

The description + topics fields make the signal dense enough for AI scoring to extract meaningful themes around SaaS, developer tools, AI, and productivity — the core categories idea.ai tracks.
