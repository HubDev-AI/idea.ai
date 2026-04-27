---
date: 2026-04-24
topic: boring-websites-idea-ai-integration
focus: Implement the 2026-updated boring-websites program as modules inside the existing idea.ai codebase
mode: repo-grounded
---

# Ideation: Boring-Websites Program as Features of idea.ai

## Grounding Context

**Two source documents (both in `docs/boring-websites/`):**
- `boring_websites_automation_plan.md` — 2020-era playbook: FIND via SEO tools → CLONE with AI → MONETIZE via ads across a 20-site portfolio, targeting $10k MRR in 12 months.
- `ideation/2026-04-24-boring-websites-plan-feynman-research.md` — first-principles stress-test. Plan's core loop is structurally broken between 2023 and 2026 by three forces the plan doesn't mention: AI Overviews (58% CTR loss, 69% zero-click on calculator/converter/template SERPs), HCU + March 2024 spam + March 2026 Information Gain updates (targets AI-authored clones; 1,446+ sites deindexed), and the cloning moat inverted (supply and demand both commoditized). Median indie project MRR is $500/mo; 20 thin sites is not "average $500" — it's "most fail, one might hit."

**Broken premises (Feynman):** A2 (10-100k traffic monetizable via ads), A4 (gap analysis reveals openings), A6 (concept-clone differentiates), A7 (AI content ranks), A11 (affiliate scales linearly), A12 (20-site portfolio averages), M1 (automation near-zero cost — Ahrefs API $1.5k/mo enterprise; realistic $300-2k/mo tooling floor).

**2026 survival mechanics:** interactive stateful tools, proprietary data, <30% AI content, brand search volume as terminal metric (0.334 correlation with LLM citations — beats backlinks), Reddit top-5 cited across ChatGPT/Perplexity/Google AI Mode, multi-language arbitrage (60%+ searches non-English), freemium micro-SaaS (41% margins, 40-60x exit vs content's 28-38x), B2B lead-gen ($20-200/lead, qualification resists commoditization). Survivor cases: Nomad List ($47k/mo), Zapier programmatic (70k pages backed by integration graph), AI tool directory $25k/mo → $944k exit (curated dataset, not content clone).

**idea.ai codebase summary (what this ideation rides):** TypeScript/Node pnpm monorepo. SaaS "idea engine for solo founders."
- `packages/connectors/` — 20+ connectors (HN, Reddit scrape, GitHub, ProductHunt, App Store, Bluesky, G2, StackOverflow, TikTok, Crunchbase BYO, Exa/Perigon BYO, etc.), hourly/daily refresh independent of research-agent interval
- `packages/pipeline/` — Bayesian, velocity, CUSUM, correlation, supply/demand, dedup, noise gates, weight optimization, AI post-scrape rewrites
- `jobs/entity_extractor.ts` — respects AI provider settings; runs after every connector refresh
- `jobs/research_agent.ts` — interval-driven thesis / deep-dive / debate with memory retrieval
- `packages/ai-runtime/` — Claude / Codex / Ollama router with single/ensemble modes, fallback, retries
- Storage: Postgres (signals, ideas, scores, entities, theses, agent runs, memory, logs) + Redis + JSON execution logs
- `apps/api/` Fastify REST + WebSocket, `apps/web/` React/Vite UI
- **Notable gaps for boring-sites use case:** no Stripe, no i18n, no SSG for hosted tools, no Reddit API (scrape only), no Google Search Console ingestion, no SERP API, no notifications

**Criteria for this ideation:** idea.ai-native shape (connector / scorer / research-agent task / entity-extraction pattern) × AIO-resistant per Feynman × implementable by single operator × structurally matches the codebase's plug-in conventions.

## Ranked Ideas

### 1. Asset-Lifecycle Research-Agent Task (90-Day Kill-Gate)
**Description:** New research-agent job wired into the existing interval scheduler (alongside thesis, deep-dive, debate). For each launched asset, tracks (a) brand-search volume slope via GSC/SERP API, (b) LLM citation count via idea #2 below, (c) session trend. Emits a pre-committed keep/kill/pivot verdict at day 30/60/90, structured as a thesis with reasoning attached. Operator receives it as a signal card in the existing UI.
**Rationale:** Single biggest silent killer of solo portfolios is refusing to kill losers. Feynman A12 broken means correlated HCU risk drains capital/attention from survivors. Research-agent shape already exists — add one more task type. Automates the hardest human decision using data the other connectors and scorers gather anyway. Highest confidence-to-complexity ratio of the survivors.
**Downsides:** Pre-committed criteria can mis-fire on slow-starting assets. Requires GSC ingestion (new connector — bundled with idea #2). Operator override undoes the whole value proposition; need design-level discipline (e.g., 7-day cooldown before override is accepted).
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 2. Reddit API Pain-Listener Upgrade
**Description:** Upgrade existing Reddit scrape connector to official Reddit API (OAuth2 + PRAW-style streaming). Add pain-phrase entity-extraction prompts targeted at specific boring-business subs (r/smallbusiness, r/Accounting, r/ElectriciansUK, r/Freelance, national trade subs, non-English professional communities). Output: recurring unresolved-pain clusters with velocity, frequency, and geographic attribution. Feeds the scoring pipeline as a new signal class.
**Rationale:** Reddit is a top-5 LLM-cited domain across ChatGPT/Gemini/Perplexity. Genuine pain signals from community threads beat keyword-tool opportunities that are already saturated. Existing connector slot + existing entity extractor means the delta is API migration + prompt tuning. Cheapest-to-build of the 7; unlocks the discovery signal Feynman identifies as 3-6 months ahead of keyword tools.
**Downsides:** Reddit API rate limits + pricing (post-2023 API changes) have real cost. Subreddit moderators can ban polling. Pain-phrase prompts are vertical-specific and require iterative tuning. Non-English sub coverage requires per-language prompt variants.
**Confidence:** 85%
**Complexity:** Low
**Status:** Unexplored

### 3. AIO-Survival Scorer (pipeline module)
**Description:** New scorer in `packages/pipeline/` alongside Bayesian / velocity / correlation. Factors: query-class AIO-answerability (negative — punishes stateless calc/converter targets), stateful-tool requirement (positive), proprietary-data requirement (positive), Reddit citation presence (positive), LLM citation presence (positive — from idea #6), multi-language opportunity depth (positive), regulatory-moat requirement (positive). Replaces plan's 5-gate ≥65/100 opportunity rubric. Plugs into existing weight-optimization loop so weights tune against downstream outcomes.
**Rationale:** Plan's rubric treats AIO and Information-Gain ranking as if they don't exist. Feynman A3 premise is broken — the score is false precision. A scorer that directly models 2026 survival converts Feynman's qualitative findings into reusable filter logic and rides the entire existing scoring ensemble. Makes Feynman's conclusions enforceable, not suggestive.
**Downsides:** Initial weights are judgment until a feedback loop exists. AIO-answerability detection needs per-query classification (LLM call per scoring cycle — budget creep). Some factors (multi-language depth, regulatory moat) require upstream enrichment that doesn't exist yet.
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

### 4. Proprietary-Dataset-First Validation Gate (upstream of scorer)
**Description:** New gate that runs upstream of the AIO-Survival Scorer. Rejects any opportunity that cannot produce a shippable 50-500-row proprietary dataset within 30 days using existing idea.ai connectors + entity extraction. The gate runs as a capability check: does this candidate map onto connectors we already run, or a connector we could build in under a week? If no, drop.
**Rationale:** Turns idea.ai's own infrastructure into the gating mechanism for which niches to attempt — you only pursue where you already have a structural edge. Feynman 2026 survival requires proprietary data; plan's scoring treats data availability as a soft factor. A hard gate eliminates candidates where idea.ai offers nothing, and as a free side-effect surfaces which connectors are actually valuable for this vertical, guiding backlog prioritization.
**Downsides:** Risk of false negatives — drops niches where a third-party dataset exists but isn't in idea.ai's connector set yet. Gate logic needs a human-in-the-loop override for borderline candidates.
**Confidence:** 75%
**Complexity:** Low-Medium
**Status:** Unexplored

### 5. HCU-Casualty & Flippa Acquisition-Target Connector
**Description:** New connector that ingests Flippa + Empire Flippers listings filtered by price/traffic/niche/age, plus a parallel stream that detects HCU casualties (domains with recent traffic collapses via Wayback snapshots + SimilarWeb/SEMrush estimate deltas via BYO API). Outputs "wounded brand with rebuildable moat" signals with suggested stateful-layer bolt-ons (login + user-state + proprietary-data overlay).
**Rationale:** Plan assumes greenfield build. 2024-2026 HCU + spam + Information-Gain casualties created a buyer's market; aged domains + backlinks + brand search are cheaper to buy than to earn. Open question #5 (build vs buy) becomes answerable with data instead of guesswork. Pure connector shape; fits idea.ai pattern exactly. Complements the greenfield path rather than replacing it.
**Downsides:** Flippa's public listing coverage is partial (sellers gate financials behind NDA). Traffic-collapse inference is probabilistic, not diagnostic. Acquired assets carry penalty risk that cannot be fully audited pre-purchase.
**Confidence:** 70%
**Complexity:** Medium
**Status:** Unexplored

### 6. LLM-Citation-Gap Connector
**Description:** New connector that periodically queries ChatGPT / Perplexity / Gemini / Google AI Mode for target niche prompts, parses cited domains, and emits signals where (a) weak/outdated sources are cited or (b) no citations exist at all. Feeds entity extraction + scoring to surface citation-gap opportunities. Dual-use: measurement input for idea #1 (kill-gate) and signal input for ideas #3 and #4.
**Rationale:** Brand search volume has 0.334 correlation with LLM citations — stronger predictor than backlinks. LLM citations are a new, underinstrumented distribution channel; idea.ai is well-shaped to own measurement here. Connector shape is already the idea.ai conventional plug-in; this is strictly additive. Directly addresses Feynman's open question #4 (discovery-signal preference).
**Downsides:** API costs per query × N niches × M LLMs compound fast; need aggressive caching + sampling. Some providers (AI Mode) don't expose an API — requires headless-browser fallback or BYO scraper. LLM citation outputs change frequently; time-series normalization is nontrivial. Google AI Mode and Perplexity change citation behavior with each model update.
**Confidence:** 75%
**Complexity:** Medium-High
**Status:** Unexplored

### 7. Regulatory-Data Refinery + API-as-Product
**Description:** New connectors for official sources (EU VAT tables, national tax tables, stamp duty, minimum wage, severance rules, VAT registration thresholds, payroll coefficients, social contribution bands). Normalized into Postgres entity store via existing entity-extraction pipeline with source-provenance and last-verified timestamps. Exposed as idea.ai's first external product via the existing Fastify API: `/v1/rates`, `/v1/rules`, `/v1/compliance`. Licensed at $500-5k/mo to B2B buyers (accounting SaaS, legal-tech, other operators in the space).
**Rationale:** Converts plan's biggest maintenance pain (country-rule drift silently invalidating calculators) into the defensible asset and a second revenue line decoupled from SERP. Matches the AI-tool-directory $25k → $944k exit pattern (dataset, not content). Rides existing connector + entity + API infrastructure. The product surface is parallel to — not competing with — whatever end-user sites the operator builds on top of the same data.
**Downsides:** Legal/liability exposure from wrong rates (disclaimers + human review on regulated updates required). Source-site change detection is fragile (sites break parsers without notice). API-as-product requires Stripe/auth layers idea.ai doesn't currently have — first-time cost is real. Highest complexity of the 7 because it touches billing, auth, quota, and contract law.
**Confidence:** 70%
**Complexity:** High
**Status:** Unexplored

## Rejection Summary

49 raw candidates across 6 frames (pain/friction, inversion, assumption-breaking, leverage, cross-domain analogy, constraint-flipping). Full rejection log in `${TMPDIR}/compound-engineering/ce-ideate/7f745f27/survivors.md`. Summary below groups the 42 rejected candidates by reason.

| Category | Count | Representative examples | Reason rejected |
|---|---|---|---|
| Strategy / doctrine, not a module | 12 | Two-asset 24-month horizon, Exit-first frame, DE/PT/ES-first, 200 humans playbook, Single forever-niche | Belongs in the updated plan document, not the idea.ai codebase |
| Subsumed by a survivor | 13 | Pain-to-stateful-tool pipeline (→ #3), Flippa buy-and-harden (→ #5), Kill-gate (→ #1), Dataset-as-product (→ #7), Cross-language ideas (→ #3's scorer weights) | Stronger idea covers the same ground |
| Different business entirely | 7 | Sell the system, OSS calculator engine, H&R Block franchise, Stock-photo library, Trade-mag, Ham-radio community, 100-contributor OSS collective | Not implementable as an idea.ai feature |
| Requires major missing infra | 4 | Translation-as-distribution, English-banned multilingual, Zero-maintenance evergreen, Freemium micro-SaaS spine | Needs Stripe / i18n / SSG / auth that idea.ai doesn't have; first-time cost exceeds value |
| Non-automatable | 3 | Pre-sell before build, Trade-body partnership, Regulatory-moat-before-SEO | Manual human processes; not expressible as connectors / scorers / agents |
| Violates explicit exclusion | 3 | 20-site thin portfolio, AI clone sites ranking, SEO-tool scraping edge, Keyword-gap SERP openings | Feynman findings place these on the "do not propose" list |

## Implementation Shape Notes

The seven survivors form a natural three-wave sequence, given idea.ai's existing infrastructure:

- **Wave 1 (low-complexity, highest-confidence, unlocks the rest):** #2 Reddit API Pain-Listener, #4 Proprietary-Dataset-First Gate, #1 Asset-Lifecycle Research-Agent task skeleton. These require no new external dependencies and produce signals the other ideas can consume.
- **Wave 2 (medium-complexity, depend on Wave 1 signals):** #3 AIO-Survival Scorer (consumes #2's pain signals + new weights), #6 LLM-Citation-Gap Connector (new external API surface; drives measurements for #1 and weights for #3).
- **Wave 3 (high-complexity, require new infrastructure):** #5 HCU-Casualty & Flippa Connector (needs BYO SEMrush/SimilarWeb quota + Wayback orchestration), #7 Regulatory-Data Refinery + API-as-Product (needs Stripe/auth/quota layers idea.ai lacks).

Waves 1-2 (five ideas) are achievable without leaving idea.ai's current infra envelope. Wave 3 introduces real first-time costs — whether to pay them is the build-vs-buy decision for idea.ai itself.

## Country × Niche Selection Engine

The operator's biggest concrete decision is not "build a calculator" — it is **"which (country, niche, language) pair to build next, and is the winning path greenfield or acquisition?"** The seven survivors above each supply pieces of that answer; this section wires them into one end-to-end selection engine with five additional mechanisms (A-E) that the earlier survivors implied but did not name explicitly.

### Why the pair-selection question is the bottleneck

Countries × niches × languages is combinatorial: roughly 50 × 20 × 10 ≈ 10,000 candidate pairs. Plan Part 3 treats this as a ranking problem over a flat keyword list. Feynman 2026 reality makes that wrong — most of the 10,000 are AIO-dead, HCU-lethal, or community-less before any scoring is applied. The operator wants one dashboard that says "launch DE × VAT-rule-monitor (acquire)" or "pt-BR × freelancer-tax-calc (greenfield)" with evidence attached, not a 10k-row spreadsheet.

### Mechanism A — (Country × Niche) Opportunity Matrix (read-model + UI)
**Description:** New Postgres entity `opportunity_pairs(country, niche, language, score_breakdown, action_tag, last_enriched_at, provenance)`. One row per surviving pair after Mechanism B prunes. Each cell enriched by Mechanisms C1-C4 and scored by the AIO-Survival Scorer (survivor #3). UI surface: heatmap view + sortable table on `apps/web/`. Top cells drill through to a research-agent deep-dive (idea.ai's existing `jobs/research_agent.ts` thesis output).
**Rationale:** Converts 10k combinatorial guesses into a single ranked artifact the operator scans weekly. Uses existing storage + entity extraction + research-agent shapes; no new subsystem. Directly answers the user's stated bottleneck.
**Downsides:** Score-breakdown explainability requires UI design work; without it, the matrix becomes a magic number. Stale enrichment cadence is a real risk (regulatory / SERP / AIO data drift faster than weekly re-enrichment).
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### Mechanism B — Language-First Pruning Gate
**Description:** Operator pre-commits 2-3 target languages they can operate in (read native, find paid native reviewer, participate in community). Config lives in the existing env/settings layer (`AI_PROVIDER`-style flag, e.g., `BORING_SITES_LANGUAGES=de,pt-BR,en`). All (country × niche) pairs outside those languages auto-drop before any enrichment or scoring runs.
**Rationale:** Kills decision fatigue and API budget in one stroke — 10k pairs → ~60 in constant time. Encodes the Feynman survival mechanic "human editorial review on high-intent pages" as a hard infrastructure constraint. Prevents the scorer from ranking pairs the operator cannot actually execute on.
**Downsides:** Hard-excludes long-tail opportunities the operator could reach with contractors. Requires honest self-assessment of language capability.
**Confidence:** 90%
**Complexity:** Low
**Status:** Unexplored

### Mechanism C — Four Per-Pair Enrichers

Each enricher produces one numeric factor for the AIO-Survival Scorer (survivor #3). Built as connector+prompt pairs following existing idea.ai conventions.

**C1. Regulatory-complexity-as-moat scorer factor**
Per-pair signal: rule stability × official-data availability × update-cadence predictability. High stable complex with good official source = defensible (AI-generic content cannot beat it; regulatory moat is the anti-AIO). Data sources: EU eur-lex, gov.uk, bgbl.de, gesetze-im-internet.de, national official gazettes, tax-authority APIs where available.
**Confidence:** 75% / **Complexity:** Medium

**C2. Native-subreddit / forum density**
Per (country, language, niche) count active native-language communities with ≥1k members and recent pain-phrase density. Zero communities = auto-reject at gate (no brand-search seeding pathway; survivor #2 output has no soil). Non-zero = feeds velocity score.
**Confidence:** 80% / **Complexity:** Low-Medium

**C3. LLM-citation-gap-by-locale**
Run survivor #6's LLM-Citation-Gap Connector with native-language prompt sets per pair. Pairs where ChatGPT / Perplexity / Gemini / Google AI Mode cite weak/outdated/zero sources = blue-ocean flag. Output: citation-gap score + list of query prompts where no good answer exists yet.
**Confidence:** 75% / **Complexity:** Medium-High

**C4. Local monetization-floor calibration**
Per-country RPM / lead-value / average-transaction-value calibration using published Mediavine, Raptive, and lead-gen comp data, cross-checked against idea.ai's existing Bayesian scoring. Reject pairs where projected revenue-per-session × plausible session ceiling < idea.ai's own cost floor ($300-2k/mo tool overhead per Feynman M1).
**Confidence:** 70% / **Complexity:** Low-Medium

### Mechanism D — Pain-Signal Country Attribution (bottom-up populator)
**Description:** Extend survivor #2's Reddit-API Pain-Listener entity-extraction prompts to tag each pain signal with country/locale derived from (a) subreddit + flair, (b) language detection, (c) mentioned jurisdictions in thread body, (d) user-profile hints where public. Attribution output populates the Mechanism A matrix bottom-up: high-frequency unattributed-until-now pairs surface as candidate rows alongside the top-down catalog.
**Rationale:** Top-down matrix (A) has cold-start bias — it ranks what's already in the catalog. Bottom-up attribution discovers pairs the catalog missed (e.g., an overlooked profession × country combination that Reddit threads reveal as an underserved cluster). Complements A without replacing it.
**Downsides:** Language detection is noisy on short pain phrases; jurisdiction extraction from natural-language posts has ~70% accuracy in practice. Requires human periodic sampling for quality.
**Confidence:** 80%
**Complexity:** Low-Medium
**Status:** Unexplored

### Mechanism E — HCU-Casualty Geography Overlay
**Description:** Filter survivor #5's HCU-Casualty & Flippa Connector output by country. For each Mechanism A matrix cell, count wounded-brand supply ≥3 within the past 24 months. If supply is present, tag the pair `action=acquire-rebuild` and attach listing URLs + collapse-evidence. Otherwise tag `action=greenfield-build`. Dashboard surfaces the tag alongside the score.
**Rationale:** Same pair can have radically different expected value depending on whether an acquirable wounded brand exists in that country. Operator reading the matrix gets a direct build-vs-buy decision, not a score abstracted from path.
**Downsides:** Flippa public coverage is partial per country (strong US/UK, thin DE/PL/BG). Casualty inference via Wayback + traffic estimates is probabilistic.
**Confidence:** 70%
**Complexity:** Medium (bundled with survivor #5)
**Status:** Unexplored

### End-to-end pipeline

```
┌─ discrete catalog ──────────────────────────────────────┐
│  countries × niches × languages  (≈10k candidate pairs) │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
      ┌────────────────────────┐
      │ B. Language-first      │   operator pre-commits 2-3 languages
      │    pruning gate        │   → ~60 surviving pairs
      └────────────┬───────────┘
                   │
    ┌──────────────┼──────────────┐
    ▼              ▼              │
┌─────────┐  ┌──────────────┐     │
│ catalog │  │ D. pain      │     │  top-down catalog
│  rows   │  │ attribution  │     │  + bottom-up Reddit
│         │  │ (survivor #2)│     │  attribution both
└────┬────┘  └───────┬──────┘     │  populate the matrix
     └──────┬────────┘            │
            ▼                     │
   ┌──────────────────────┐       │
   │ Mechanism A matrix   │       │
   │ (opportunity_pairs   │       │
   │  Postgres entity)    │       │
   └──────────┬───────────┘       │
              │                   │
              ▼                   │
   ┌──────────────────────────────┴──────────┐
   │ per-pair enrichment                     │
   │  C1 regulatory-complexity-as-moat       │
   │  C2 native community density            │
   │  C3 LLM-citation-gap-by-locale (S#6)    │
   │  C4 local monetization floor            │
   └──────────────────┬──────────────────────┘
                      │
                      ▼
       ┌─────────────────────────────────┐
       │ #3 AIO-Survival Scorer          │
       │  (weighted ensemble; existing   │
       │   Bayesian/velocity/correlation │
       │   pipeline)                     │
       └──────────────┬──────────────────┘
                      │
                      ▼
       ┌─────────────────────────────────┐
       │ E. HCU-casualty geography       │
       │    overlay (survivor #5)        │
       │   tag: acquire-rebuild |        │
       │        greenfield-build         │
       └──────────────┬──────────────────┘
                      │
                      ▼
       ┌─────────────────────────────────┐
       │ dashboard (apps/web/):          │
       │  heatmap + sortable table of    │
       │  top N pairs with action tag,   │
       │  score breakdown, evidence.     │
       │  drill-through → research agent │
       │  thesis (existing job)          │
       └──────────────┬──────────────────┘
                      │
                      ▼
       ┌─────────────────────────────────┐
       │ operator launches ONE asset     │
       │ (acquire or build)              │
       └──────────────┬──────────────────┘
                      │
                      ▼
       ┌─────────────────────────────────┐
       │ #1 asset-lifecycle kill-gate    │
       │ research-agent task             │
       │ (30/60/90-day verdicts)         │
       └──────────────┬──────────────────┘
                      │
                      ▼
       ┌─────────────────────────────────┐
       │ feedback loop: outcome updates  │
       │ AIO-Survival Scorer weights     │
       │ (existing weight-optimization   │
       │  loop in pipeline)              │
       └─────────────────────────────────┘
```

### How this maps to the seven survivors

| Pipeline stage | Rides | Adds |
|---|---|---|
| Language prune (B) | idea.ai env-config pattern | Mechanism B itself (low-cost) |
| Bottom-up attribution (D) | Survivor #2 Reddit-API Pain-Listener + existing entity extractor | Country/locale tagging prompts |
| Matrix entity (A) | Postgres + entity-extraction pipeline + `apps/web/` | `opportunity_pairs` table + heatmap/table UI + drill-through |
| Enrichment C1 | Existing connector shape | New official-source connectors (eur-lex, gov.uk, bgbl.de, national gazettes) + scorer factor |
| Enrichment C2 | Existing Reddit scrape + entity extractor | Subreddit-density prompt + scorer factor |
| Enrichment C3 | Survivor #6 LLM-Citation-Gap Connector | Native-language prompt set per target language |
| Enrichment C4 | Existing Bayesian scorer | Country-RPM / lead-value calibration dataset |
| Weighted scoring | Survivor #3 AIO-Survival Scorer | C1-C4 factor weights |
| Acquisition overlay (E) | Survivor #5 HCU-Casualty & Flippa Connector | Country filter + action-tag join on matrix |
| Lifecycle verdicts | Survivor #1 Asset-Lifecycle Research-Agent task | Feedback loop into scorer weight optimization |

### Build sequence (refines earlier wave plan)

- **Wave 1 — selection engine skeleton.** B language prune + A matrix entity + C2 community density + D pain attribution. All ride existing connectors + entity extraction + UI scaffolding. Operator gets a first crude ranking within days of integration, not weeks.
- **Wave 2 — enrichment depth.** C1 regulatory-complexity scorer + C3 LLM-citation-gap (survivor #6) + C4 monetization-floor + survivor #3 AIO-Survival Scorer tying them together. Matrix scores become meaningful.
- **Wave 3 — action tags + feedback.** E HCU-casualty geography overlay (bundled with survivor #5) + survivor #1 asset-lifecycle kill-gate wiring outcomes back into C1-C4 weights.

Wave 1 alone answers the user's "which country, which site" question with a best-effort crude ranking. Waves 2-3 sharpen the answer and close the feedback loop. Survivor #7 (Regulatory-Data Refinery + API-as-Product) is orthogonal — it monetizes the connector outputs from C1 as a parallel product line and is independent of the selection engine's sequencing.
