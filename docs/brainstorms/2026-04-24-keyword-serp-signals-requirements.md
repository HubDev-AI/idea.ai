---
date: 2026-04-24
topic: keyword-serp-signals
---

# Keyword SERP Signals for the Country × Niche Engine

## Problem Frame

The Country × Niche Selection Engine (per `docs/boring-websites/ideation/2026-04-24-boring-websites-idea-ai-integration-ideation.md`) needs per-keyword SERP data to power three scorers: SERP-weakness (who's defending the niche), AIO presence (is this query already answered zero-click), and competitor identification (who ranks top 10 and how weak are they). Existing connectors cover news (Perigon BYO), neural web search (Exa BYO), and demand-shape trends (`google_trends.ts`), but none expose parsed Google SERP listings with country + language targeting. Without this signal, the matrix scorer runs blind to rank defense and cannot distinguish "wide-open niche" from "incumbent-saturated niche" — the single decision Feynman 2026 research says differentiates viable from dead candidates post-HCU. Target user: the solo operator scanning the Country × Niche matrix dashboard. Affected components: `packages/connectors/`, `packages/pipeline/`, `jobs/entity_extractor.ts`.

## Requirements

**Signal Coverage**
- R1. For a given `(keyword, country_code, language)` tuple, return top-100 organic SERP results with position, url, domain, title, snippet, and displayed_link.
- R2. Capture presence and content of AI Overview (AIO) when displayed for the query — parsed text + cited sources when available.
- R3. Capture People-Also-Ask entries (question + answer snippet) when present.
- R4. Capture featured snippet, knowledge panel, and shopping/ads block presence flags (binary — full parsing not required initially).
- R5. Record raw SERP fetch timestamp and the provider's result identifier for dedupe and time-series analysis.

**Vendor Integration**
- R6. Follow the existing BYO connector pattern: credential via `{VENDOR}_API_KEY` env var, daily spend guard via `{VENDOR}_DAILY_BUDGET_USD` env var, return `ByoConnectorResult` shape (see `packages/connectors/src/byo_guard.ts`).
- R7. Connector must be skippable (not errored) when credentials or budget are absent — match `exa_byo.ts` / `perigon_byo.ts` behavior.
- R8. Emit telemetry entries identical in shape to existing BYO telemetry (connector name, skipped flag, reason, budget_usd).
- R9. Default vendor is DataForSEO SERP API. Interface must be vendor-agnostic enough that a second provider (e.g., SerpAPI, ValueSERP) can be swapped in behind the same output contract without pipeline changes, but a full multi-vendor switch (Approach C from brainstorm) is deferred.

**Matrix Batch Support**
- R10. Support batch query ingestion — the matrix scorer runs N pairs × M keywords = ~1000-2000 queries per refresh. The connector must use DataForSEO's async/queued endpoint (not live-only) to handle batch without sequential rate-limit bottlenecks.
- R11. Expose a single `runSerpByoConnector(inputs: SerpQuery[])` call that the ingestion scheduler invokes, where each `SerpQuery` carries `(keyword, country_code, language)`.
- R12. Batch results must arrive as individual `RawEventInput` rows per `(keyword, country, language, result_position)` so existing entity extraction, scoring, and deduplication work without downstream changes.

**Country × Language Targeting**
- R13. Accept ISO country codes (e.g., `DE`, `PL`, `BG`, `pt-BR`) and map to the vendor's native `location_code` / `language_code` parameters.
- R14. Coverage target: the full set of countries supported by the Language-First Pruning Gate (Mechanism B), which is the operator-configured subset of ~50 candidates.
- R15. Reject queries for unsupported (country, language) pairs with a clear telemetry reason rather than silently querying an English-default.

**Cost & Rate Control**
- R16. Daily USD budget enforced via the existing BYO guard — connector refuses to start if spend-to-date ≥ `DATAFORSEO_DAILY_BUDGET_USD`.
- R17. Per-connector run emits an estimated-spend preview before issuing vendor calls so the operator can cap a runaway matrix refresh.
- R18. Batch size cap per connector run (configurable env, default TBD in planning) to limit exposure when budget checks lag.

**Output Shape for Downstream Scoring**
- R19. Each emitted signal event carries enough structured context (position, domain, AIO presence, PAA presence) for the following scorers to consume without re-fetching: SERP-weakness factor, AIO-Survival Scorer's AIO-answerability weight, competitor-identification entity extraction.
- R20. Keep raw vendor response in a provenance field (JSON blob or reference) so downstream consumers can re-parse for features not yet modeled without re-querying.

**Testing**
- R21. Unit tests mirror the testing pattern in `packages/connectors/tests/` for existing BYO connectors — mock the HTTP layer, test the guard paths (missing key, exhausted budget, active), test the batch-to-events transformation, test country/language mapping.
- R22. Include at least one fixture SERP response for a non-English locale (German, Polish, or Portuguese-BR) to catch mis-encoding regressions.

## Success Criteria

- The Country × Niche matrix scorer can compute a non-null SERP-weakness factor and AIO-presence factor for every pair the Language-First Pruning Gate admits, after one successful connector run.
- Operator can run a full matrix refresh (~60 pairs × ~20 keywords = 1200 queries) for under $5 of DataForSEO spend on a typical day.
- The connector can be disabled (unset `DATAFORSEO_API_KEY`) without breaking any pipeline or UI component — matrix cells missing SERP data show a clear "not enriched" state rather than an error.
- Swapping DataForSEO for SerpAPI behind the same connector interface requires changing only one provider adapter file and the env var name, not the pipeline or entity extractor.
- No keyword-volume or keyword-difficulty signal is produced by this connector — that is a separate decision (see Scope Boundaries).

## Scope Boundaries

- **Out:** Keyword search volume, keyword difficulty, competitive density, and related-keyword discovery. These are Ahrefs/SEMrush/DataForSEO-Keywords-endpoint concerns and will be a separate brainstorm when demand-sizing becomes a scoring factor.
- **Out:** Branded-query / owned-site tracking via Google Search Console. That is a post-launch kill-gate input (survivor #1) and a different OAuth surface. Separate brainstorm.
- **Out:** LLM citation monitoring (ChatGPT / Perplexity / Gemini / Google AI Mode). That is survivor #6's LLM-Citation-Gap Connector and a parallel signal source. Separate brainstorm.
- **Out:** Multi-vendor switch (Approach C). Interface stays swappable but only one provider is implemented now.
- **Out:** Page-content fetching of ranked URLs for competitor analysis. That is a downstream, not-on-the-SERP-vendor concern — use Exa / existing scraping for that if needed later.
- **Out:** Retroactive backfill of SERP history — the connector emits only current-refresh results.

## Key Decisions

- **DataForSEO SERP as default BYO vendor.** $0 monthly floor, ~$0.001 per query, native 100+ country / all-language support, native AIO parsing, async bulk endpoint. At 1200 queries per refresh × weekly cadence, monthly spend stays under $50.
- **Async/queued endpoint, not live.** Matrix-refresh is batch by nature; live endpoints are rate-limited and 3-5x the cost of async.
- **Keep existing `google_trends.ts` unchanged.** Complementary free demand-shape signal; not replaced by SERP data.
- **Vendor-agnostic connector interface; single provider now.** Builds future swap-ability without the maintenance cost of multi-vendor today.
- **Raw vendor payload preserved in provenance field.** Unknown future scorers / features can re-parse without re-querying — small storage cost vs large API re-spend cost.
- **AIO capture mandatory.** The AIO-Survival Scorer's entire thesis depends on knowing which queries are AIO-answered. Non-AIO-capturing vendors (e.g., raw Google scraping) are not acceptable alternatives.

## Dependencies / Assumptions

- DataForSEO supports AI Overview capture as a parsed feature (verify current coverage during planning — vendor has shipped AIO parsing but feature flags and regional rollout should be confirmed). **[Needs research during planning]**
- DataForSEO async/queued endpoint returns within the connector-refresh cadence window that the ingestion scheduler uses for other BYO connectors. **[Needs research during planning — check current scheduler cadence vs vendor's async turnaround]**
- Reddit API Pain-Listener upgrade (survivor #2) is not a dependency for this connector, but is the source of `niche` attribution feeding `SerpQuery` inputs once the matrix is populated from bottom-up signals. SERP connector can ship and be tested with a manual keyword seed list first.
- The Language-First Pruning Gate (Mechanism B) is not yet implemented; this connector's R15 (reject unsupported (country, language) pairs) assumes the gate will eventually feed it a filtered candidate set, but pre-gate the connector accepts any caller-supplied input.
- The AIO-Survival Scorer (survivor #3) is not yet implemented; R19's coverage contract is written against that scorer's anticipated inputs. If scorer design changes materially, R19 may need revision.

## Outstanding Questions

### Resolve Before Planning

_(none — product decisions are resolved; the connector scope, vendor, and interface are locked)_

### Deferred to Planning

- **[Affects R10, R11][Technical]** What is the correct refresh cadence for matrix SERP data? Weekly (cheap, stale risk) vs daily (expensive, fresher) vs on-change-trigger (complex). Planning should propose based on DataForSEO async turnaround + matrix-use patterns.
- **[Affects R18][Technical]** What is the right default `MAX_BATCH_PER_RUN` value? Depends on DataForSEO's per-request bundle limit and the `DATAFORSEO_DAILY_BUDGET_USD` default.
- **[Affects R2][Needs research]** Confirm DataForSEO's AIO parsing coverage per country as of 2026-04 — note recent vendor roadmap, confirm whether any country/language combinations return AIO-present flag without parsed body and handle that case explicitly.
- **[Affects R20][Technical]** Storage shape for the raw vendor payload — new JSONB column on the signals entity, separate `serp_raw_responses` table, or object-storage reference? Planning should decide based on storage cost and re-parse frequency.
- **[Affects R13][Technical]** Exact ISO-to-vendor mapping table. DataForSEO uses numeric `location_code` and string `language_code`. Planning should produce the lookup (likely a committed JSON file) covering all countries the operator configures in the Language-First Pruning Gate.
- **[Affects R19][Needs research]** Validate assumption that the AIO-Survival Scorer's current (unimplemented) interface can consume R19's emitted fields without a pre-aggregation pass. If an aggregation layer is needed, that is a pipeline concern, not a connector concern.

## Next Steps

- `/ce-plan` for structured implementation planning. Planning should resolve the Deferred-to-Planning questions above, reference `packages/connectors/src/byo_guard.ts` and `packages/connectors/src/exa_byo.ts` for the BYO pattern, and sequence this work inside Wave 2 of the Country × Niche engine build plan in `docs/boring-websites/ideation/2026-04-24-boring-websites-idea-ai-integration-ideation.md`.
