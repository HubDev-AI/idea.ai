---
title: "feat: Language-First Pruning Gate (Mechanism B)"
type: feat
status: active
date: 2026-04-24
origin: docs/boring-websites/ideation/2026-04-24-boring-websites-idea-ai-integration-ideation.md
---

# feat: Language-First Pruning Gate (Mechanism B)

## Overview

Implements Mechanism B from the Country×Niche Selection Engine. The operator pre-commits 2–3 target languages and a niche keyword seed list via env vars. A pure `buildSerpQueries` function cross-multiplies surviving (country, language) pairs from the location map with keywords to produce `SerpQuery[]`, which is injected into the BYO ingestion scheduler. This replaces the empty `serpInputs = []` placeholder and activates the DataForSEO SERP connector for real production traffic.

## Problem Frame

The SERP connector shipped in #113 but runs with `serpInputs = []` — it makes no API calls because no query generation logic exists. Mechanism B is the missing config+wiring layer. It encodes the operator's language capability as a hard infrastructure constraint (pruning ~54 country×language map entries to ~10–20 survivors per language), then cross-multiplies with a keyword list to produce actionable SERP queries. Without this, the AIO-Survival Scorer and the rest of Wave 2 have no SERP signal to consume.

## Requirements Trace

- R1. Operator declares target languages via `BORING_SITES_LANGUAGES` CSV env var (e.g., `de,pt-BR,en`)
- R2. Operator declares keyword seed list via `BORING_SITES_KEYWORDS` CSV env var (e.g., `salary calculator,VAT calculator`)
- R3. `buildSerpQueries(languages, keywords)` returns `SerpQuery[]` filtered to surviving (country, language) pairs × keywords
- R4. BCP-47 language codes in `BORING_SITES_LANGUAGES` normalize to ISO 639-1 base before map matching (`pt-BR` → `pt` matches both BR and PT map entries)
- R5. If either `BORING_SITES_LANGUAGES` or `BORING_SITES_KEYWORDS` is empty, `serpInputs = []` and the connector skips harmlessly — no behavior change from current state
- R6. A curated `SERP_PROBE_SEEDS` constant provides a ready-to-use starting keyword list for operators who prefer not to author one from scratch

## Scope Boundaries

- Mechanism A (`opportunity_pairs` table + heatmap UI) — Wave 1 but a separate task
- C2 native subreddit/forum density scorer — separate task
- D pain-signal country attribution (Reddit API upgrade) — separate task
- Country-level sub-filtering within a language (e.g., `pt-BR` → Brazil only, not Portugal) — deferred; BCP-47 base normalization covers MVP; Mechanism A scoring handles further filtering downstream
- Settings UI for language/keyword configuration — no operator config UI exists in `apps/web/`; env-var only

### Deferred to Separate Tasks

- `opportunity_pairs` Postgres entity + heatmap UI (Mechanism A): separate Wave 1 task
- Reddit API official upgrade (Mechanism D / Survivor #2): separate Wave 1 task
- C2 native community density: separate Wave 2 pre-work

## Context & Research

### Relevant Code and Patterns

- `apps/api/src/config/env.ts` — `parseCsv(value, fallback)` is the established multi-value env var pattern; used for `REDDIT_SUBREDDITS`, `B2B_SUBREDDITS`, `HOURLY_CONNECTORS`, `DAILY_CONNECTORS`. `RuntimeEnv` is the single type to extend.
- `packages/connectors/src/dataforseo_location_map.json` — 54 entries; simple keys (`"DE"`) and composite keys (`"CH_DE"`, `"BE_FR"`, `"CA_EN"`) for multi-language countries
- `packages/connectors/src/dataforseo_location_helpers.ts` — `lookupDataForSeoLocale` has the composite key split logic (`key.includes('_')` branch); mirror that split logic, but use `Object.entries(locationMap)` for iteration — `lookupDataForSeoLocale` is a point-lookup, not an iterator
- `packages/connectors/src/dataforseo_serp_byo.ts` — `SerpQuery` type; `runSerpByoConnector(inputs, env, fetch)`
- `apps/api/src/jobs/ingest_byo.ts` — `runByoConnectorIngestion({ serpInputs?, ... })` injection point; `SMOKE_TEST_SERP_INPUTS` smoke fixture (keep as-is)
- `apps/api/src/runtime/live_read_model.ts` line ~649 — `runByoConnectorIngestion(process.env, { logger, ... })` callsite; currently passes no `serpInputs`

### Institutional Learnings

- No `docs/solutions/` knowledge base exists yet in this repo

### External References

- None — pure in-process config+filtering, no new dependencies

## Key Technical Decisions

- **Env var namespace `BORING_SITES_*`, not `DATAFORSEO_*`**: The language filter is program-wide — Mechanisms C2, C3, and D will all consume `BORING_SITES_LANGUAGES`. Naming it after the SERP connector would mis-scope it.
- **Default `[]` for both env vars, not a non-empty fallback**: The connector should not incur API spend without explicit operator intent. Empty = skip is safe and reversible.
- **`buildSerpQueries` lives in `packages/connectors/src/`**: Pure function, depends only on the location map and `SerpQuery` type — both already in that package.
- **BCP-47 base normalization**: `'pt-BR'.split('-')[0]` → `'pt'`. This means `BORING_SITES_LANGUAGES=pt-BR` includes both Brazil and Portugal. Country-level language sub-filtering is a Mechanism A concern, not a pruning gate concern.
- **Composite key handling**: Keys containing `_` are split as `CC_LANG` → `(country_code: CC, language_code: LANG.toLowerCase())`. Simple keys use the map entry's `language_code` field. Matches `lookupDataForSeoLocale`'s existing composite key logic.
- **`SERP_PROBE_SEEDS` as exported constant, not env default**: Probe seeds are a curated opt-in list — exported so operators can reference and override, but not silently activated as a default. Named "probe" because these keywords feed the Wave 2 AIO-Survival Scorer, which classifies AIO-resistance from results; the seeds themselves are not pre-filtered for AIO-resistance.

## Open Questions

### Resolved During Planning

- **Which env var namespace?** `BORING_SITES_*` (see decision above)
- **Should `SERP_KEYWORD_SEEDS` be the env var default?** No — default `[]`; seeds are an exported constant
- **Where does `buildSerpQueries` live?** `packages/connectors/src/` — same package as location map and SERP connector

### Deferred to Implementation

- Exact keyword strings in `SERP_PROBE_SEEDS`: implementer picks ~15 boring-site niche probe keywords (salary calculator, VAT calculator, payroll, stamp duty, etc.). These are probe inputs for the Wave 2 AIO-Survival Scorer — do not label them "AIO-resistant"; the scorer determines that from results.
- Whether `buildSerpQueries` needs a barrel export in `packages/connectors/index.ts`: depends on `apps/api/` import style (direct path vs barrel); check at implementation time

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
env:
  BORING_SITES_LANGUAGES=de,pt-BR,en
  BORING_SITES_KEYWORDS=salary calculator,VAT calculator,...

apps/api/src/config/env.ts
  parseCsv(BORING_SITES_LANGUAGES, []) → boringSitesLanguages: string[]
  parseCsv(BORING_SITES_KEYWORDS,  []) → boringSitesKeywords:  string[]

packages/connectors/src/serp_query_builder.ts
  buildSerpQueries(languages, keywords):
    for each key in dataforseo_location_map.json:
      if key has '_':  countryCode = key[0], langCode = key[1].toLowerCase()
      else:            countryCode = key,    langCode = entry.language_code
      normalize targets: 'pt-BR' → 'pt', 'de' → 'de', etc.
      if langCode not in normalized targets: skip
      for each keyword: emit { keyword, country_code: countryCode, language_code: langCode }
    return SerpQuery[]

  SERP_PROBE_SEEDS: string[] = [ ~15 boring-site niche probe keywords ]

apps/api/src/runtime/live_read_model.ts  (~line 649)
  serpInputs = buildSerpQueries(
    runtimeEnv.boringSitesLanguages,
    runtimeEnv.boringSitesKeywords
  )
  runByoConnectorIngestion(process.env, { logger, serpInputs, ... })
```

Example output for `BORING_SITES_LANGUAGES=de,pt-BR,en` × 15 keywords:
- German: DE, AT, CH (~3 map entries) × 15 = ~45 queries
- Portuguese: BR, PT (~2 map entries) × 15 = ~30 queries
- English: US, GB, AU, CA, IE, NZ, ... (~7 map entries) × 15 = ~105 queries
- Total ~180 queries — well inside `DATAFORSEO_MAX_BATCH_PER_RUN` default (500)

## Implementation Units

- [x] **Unit 1: Extend RuntimeEnv with boring-sites language and keyword config**

**Goal:** Add `boringSitesLanguages` and `boringSitesKeywords` to the app's config layer so the scheduler can read them.

**Requirements:** R1, R2, R5

**Dependencies:** None

**Files:**
- Modify: `apps/api/src/config/env.ts`
- Test: `apps/api/tests/config.test.ts` (create if it does not exist)

**Approach:**
- Add `boringSitesLanguages: string[]` and `boringSitesKeywords: string[]` to the `RuntimeEnv` type
- In `loadRuntimeEnv`, wire both via `parseCsv` with `[]` default
- No other files change in this unit

**Patterns to follow:**
- `REDDIT_SUBREDDITS` / `B2B_SUBREDDITS` in the same file — exact `parseCsv` pattern

**Test scenarios:**
- Happy path: `BORING_SITES_LANGUAGES=de,pt-BR,en` → `boringSitesLanguages: ['de', 'pt-BR', 'en']`
- Happy path: `BORING_SITES_KEYWORDS=salary calculator,VAT calculator` → `boringSitesKeywords: ['salary calculator', 'VAT calculator']`
- Edge case: `BORING_SITES_LANGUAGES` unset → `boringSitesLanguages: []`
- Edge case: `BORING_SITES_KEYWORDS` unset → `boringSitesKeywords: []`
- Edge case: `BORING_SITES_LANGUAGES=` (empty string) → `boringSitesLanguages: []`

**Verification:**
- `RuntimeEnv` type has both new fields
- Both fields parse via `parseCsv` with `[]` fallback
- TypeScript compiles clean across the monorepo (no type errors at usages of `RuntimeEnv`)

---

- [x] **Unit 2: `buildSerpQueries` function + `SERP_PROBE_SEEDS` constant**

**Goal:** Pure function that cross-multiplies language-filtered location map entries with a keyword list to produce `SerpQuery[]`. Includes a curated keyword seed constant for operators.

**Requirements:** R3, R4, R5, R6

**Dependencies:** None (pure function; `SerpQuery` type and location map already exist)

**Files:**
- Create: `packages/connectors/src/serp_query_builder.ts`
- Test: `packages/connectors/tests/serp_query_builder.test.ts`

**Approach:**
- Import `dataforseo_location_map.json` and the `SerpQuery` type
- Iterate all map keys. For composite keys (key contains `_`): `countryCode = key.split('_')[0]`, `langCode = key.split('_')[1].toLowerCase()`. For simple keys: `countryCode = key`, `langCode = entry.language_code`
- Normalize `targetLanguages` to ISO 639-1 base: split each on `'-'`, take first segment, lowercase (e.g., `'pt-BR'` → `'pt'`)
- Filter map entries to those whose derived `langCode` is in the normalized target set
- Cross-multiply surviving `(countryCode, langCode)` pairs × keywords → `SerpQuery[]`
- Return `[]` immediately if either `targetLanguages` or `keywords` is empty
- Export `SERP_PROBE_SEEDS: string[]` — ~15 curated boring-site niche probe keywords (implementer selects; exact strings deferred). These are probe inputs for the Wave 2 AIO-Survival Scorer — do not label them "AIO-resistant"; the scorer classifies AIO-resistance from SERP results.

**Patterns to follow:**
- `packages/connectors/src/dataforseo_location_helpers.ts` — composite key parsing: `key.includes('_')` branch. Use `Object.entries(locationMap)` for iteration; `lookupDataForSeoLocale` is a point-lookup and should not be repurposed as an iterator.

**Test scenarios:**
- Happy path: `buildSerpQueries([], ['keyword'])` → `[]`
- Happy path: `buildSerpQueries(['de'], [])` → `[]`
- Happy path: `buildSerpQueries(['de'], ['salary calculator'])` → includes entries for `DE`, `AT`, and `CH` (from `CH_DE` composite key), all with `language_code: 'de'`, `keyword: 'salary calculator'`
- Happy path: `buildSerpQueries(['en'], ['vat'])` → includes entries for `US`, `GB`, `AU`, and `CA` (from `CA_EN` composite key), all with `language_code: 'en'`
- BCP-47: `buildSerpQueries(['pt-BR'], ['keyword'])` → includes entries for both `BR` and `PT` (both have `language_code: 'pt'` in the map); BCP-47 base normalization is the cause
- Multiple languages: `buildSerpQueries(['de', 'en'], ['keyword'])` → German entries (DE, AT, CH) plus English entries (US, GB, AU, CA, ...)
- Multiple keywords: `buildSerpQueries(['de'], ['k1', 'k2'])` → each German country entry × both keywords (DE×k1, DE×k2, AT×k1, AT×k2, CH×k1, CH×k2, ...)
- Edge case: unknown language `buildSerpQueries(['xx'], ['keyword'])` → `[]`
- Edge case: case-insensitive `buildSerpQueries(['DE'], ['keyword'])` → same result as `['de']`
- Constant: `SERP_PROBE_SEEDS` is a non-empty `string[]`

**Verification:**
- `buildSerpQueries` and `SERP_PROBE_SEEDS` are exported
- All 10 test scenarios pass
- No mutation of the imported location map (pure function)

---

- [x] **Unit 3: Wire `buildSerpQueries` into the live scheduler**

**Goal:** Pass the pruned `SerpQuery[]` to `runByoConnectorIngestion` at the live scheduler callsite.

**Requirements:** R3, R5

**Dependencies:** Units 1, 2

**Files:**
- Modify: `apps/api/src/runtime/live_read_model.ts`

**Approach:**
- Import `buildSerpQueries` from `@idea/connectors/src/serp_query_builder` (or direct relative path — follow existing import style in the file)
- At the `runByoConnectorIngestion` callsite (~line 649), derive `serpInputs = buildSerpQueries(runtimeEnv.boringSitesLanguages, runtimeEnv.boringSitesKeywords)` and pass it in the `deps` object
- `runtimeEnv` is already accessible at that point — check the surrounding code at implementation time; do not introduce a new parameter if not needed
- **P0 fix:** At ~line 658 the `dedupeEvents` spread currently omits SERP events — add `...byo.connectors.dataforseo_serp_byo.events` to the spread (pattern: mirrors `...byo.connectors.exa.events`, `...byo.connectors.perigon.events`, etc.). Without this, SERP events are collected and paid for but never reach the scoring pipeline.
- **P1 fix:** At ~lines 390–399 the `ConnectorStatusRecord[]` array does not include a `dataforseo_serp_byo` entry — add one mirroring the `mapByoStatusWithPrevious` pattern used by exa/perigon/twitter. Without this, connector status UI and metrics are silent for SERP.
- **P2 fix:** At ~line 650 the non-daily fallback literal is missing the `dataforseo_serp_byo` field — add `dataforseo_serp_byo: { status: 'skipped', events: [], telemetry: { connector: 'dataforseo_serp_byo', skipped: true, budget_usd: 0 } }`. TypeScript will catch this at compile time if omitted.
- `SMOKE_TEST_SERP_INPUTS` in `ingest_byo.ts` remains untouched as a test fixture

**Test scenarios:**
- Integration: with `BORING_SITES_LANGUAGES=de` and `BORING_SITES_KEYWORDS=salary calculator` in test env, `runByoConnectorIngestion` receives `serpInputs` containing at least `{ keyword: 'salary calculator', country_code: 'DE', language_code: 'de' }`
- Integration: both env vars unset → `serpInputs = []` → SERP connector returns `{ status: 'active', events: [], poll_summary: { total: 0, retrieved: 0, timed_out: false } }`
- Regression: `apps/api/tests/ingest-byo-resilience.test.ts` all 3 cases continue to pass

**Verification:**
- `live_read_model.ts` callsite passes non-empty `serpInputs` when both env vars are set
- Existing `ingest-byo-resilience.test.ts` passes without modification
- No TypeScript compile errors

## System-Wide Impact

- **Interaction graph:** `buildSerpQueries` is a pure synchronous function. The only integration seam is the `live_read_model.ts` callsite. The SERP connector already has resilience isolation via `runSafely` in `ingest_byo.ts`.
- **Error propagation:** `buildSerpQueries` has no failure modes (iterates an in-memory JSON constant). Malformed env vars are silently coerced to `[]` by `parseCsv`. No new error paths.
- **State lifecycle risks:** None. `SerpQuery[]` is derived fresh from `runtimeEnv` on each scheduler tick. No caching, no stale state, no cross-tick accumulation.
- **API surface parity:** `BORING_SITES_LANGUAGES` will be consumed by future mechanisms (C2 community density, C3 LLM-citation-gap, D pain attribution). Establishing it in `RuntimeEnv` now makes it available to all of them without an additional config step.
- **Unchanged invariants:** `evaluateByoGuard` inside `runSerpByoConnector` still runs — credentials and budget checks are unaffected. `SMOKE_TEST_SERP_INPUTS` fixture is untouched. All other BYO connectors (exa, perigon, twitter) are unaffected.
- **Integration coverage:** Unit 3's integration scenarios cover the scheduler wiring path. `ingest-byo-resilience.test.ts` covers connector-level isolation.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Large `serpInputs` array exceeds API batch limits (3 languages × 15 keywords × ~8 countries ≈ 360 queries) | `runSerpByoConnector` already caps via `DATAFORSEO_MAX_BATCH_PER_RUN` (default 500) — no new protection needed |
| `BORING_SITES_LANGUAGES` set but `BORING_SITES_KEYWORDS` not set (or vice versa) | Both default to `[]`; `buildSerpQueries` returns `[]` if either is empty — zero API spend |
| Composite key parsing mishandles edge cases (keys with two underscores, future entries) | Current map has no double-underscore keys; test scenario coverage for composite key extraction guards this |
| Future Mechanisms (C2, C3, D) need the same language config | Single canonical `BORING_SITES_LANGUAGES` in `RuntimeEnv` established now; future consumers just read `runtimeEnv.boringSitesLanguages` |
| `.env.example` not updated → operators unaware of new env vars | Documentation note below |
| `pt-BR` silently includes Portugal queries (BCP-47 base normalization → both BR and PT map entries match `pt`) | Documented below in Operational Notes; country-level sub-filtering is a Mechanism A concern. Operator should be aware this doubles Portuguese-language API spend until Mechanism A filtering ships. |
| Mechanism B activates API spend before any Wave 2 scoring consumer exists to consume SERP signals | Expected and intentional: SERP results accumulate in the event store and are consumed once the AIO-Survival Scorer (Wave 2) ships. First crude ranking arrives within days of Wave 1 completion per origin doc. |

## Documentation / Operational Notes

- Add `BORING_SITES_LANGUAGES` and `BORING_SITES_KEYWORDS` to `.env.example` with comments:
  - `BORING_SITES_LANGUAGES=` — CSV of ISO 639-1 or BCP-47 language codes the operator can execute in (e.g., `de,pt-BR,en`). Default: empty (SERP connector skips).
  - `BORING_SITES_KEYWORDS=` — CSV of niche seed keywords for SERP queries (e.g., `salary calculator,VAT calculator`). Default: empty. See `SERP_KEYWORD_SEEDS` export in `packages/connectors/src/serp_query_builder.ts` for a curated starting list.
- Both vars are safe to leave unset on existing deployments — the connector continues to return `{ status: 'active', events: [] }` as before.
- **BCP-47 language spend:** Setting `BORING_SITES_LANGUAGES=pt-BR` will run queries for **both** Brazil (`BR`) and Portugal (`PT`) — BCP-47 base normalization maps `pt-BR` → `pt` which matches all Portuguese-language map entries. This is intentional (country-level sub-filtering is Mechanism A), but operators should budget accordingly. A `BORING_SITES_LANGUAGES=de,pt-BR,en` config with 15 probe keywords produces ~180 queries per run, of which ~30 target Portuguese-speaking countries (BR + PT).

## Sources & References

- **Origin document:** [docs/boring-websites/ideation/2026-04-24-boring-websites-idea-ai-integration-ideation.md](docs/boring-websites/ideation/2026-04-24-boring-websites-idea-ai-integration-ideation.md) — Mechanism B description, `BORING_SITES_LANGUAGES` example, Wave 1 build sequence
- Related code: `apps/api/src/config/env.ts` — `parseCsv`, `RuntimeEnv`
- Related code: `packages/connectors/src/dataforseo_location_helpers.ts` — composite key pattern
- Related PRs: #113 (DataForSEO SERP BYO connector)
- Related plan: `docs/plans/2026-04-24-feat-dataforseo-serp-byo-connector-plan.md`
