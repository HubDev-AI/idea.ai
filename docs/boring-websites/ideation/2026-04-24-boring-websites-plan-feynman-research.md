# Feynman Deep Research: Boring Websites Automation Plan

**Date:** 2026-04-24
**Subject:** `docs/boring_websites_automation_plan.md`
**Method:** First-principles deconstruction + 2025-2026 evidence stress-test. Not a requirements or implementation doc.

---

## TL;DR

The plan describes a 2020-era playbook. Its core loop — **FIND via SEO tools → CLONE with AI → MONETIZE via ads across a 20-site portfolio** — has been structurally broken between 2023 and 2026 by three compounding forces that the plan does not mention:

1. **AI Overviews** eat 58% of click-through on informational/tool SERPs and drive 69% zero-click rate. The "calculator / converter / template" sweet spot is the single most affected category.
2. **Google's HCU + March 2024 spam update + March 2026 "Information Gain" update** explicitly target what the plan proposes to produce — scaled AI-authored clones. 1,446+ sites deindexed. Median median MRR across 326 tracked indie projects: $500/mo.
3. **The cloning moat inverted.** Supply-side commoditization (anyone can spin a calculator with Claude in an afternoon) + demand-side commoditization (Google answers directly) means "findable + simple" is now anti-durable. Survivors all have proprietary data, real community, or interactive tools that resist LLM replacement.

A 2026-viable version of the plan looks almost nothing like the document. Read on.

---

## The Plan in One Sentence (faithful restatement)

> Use SEO tools and scraping to discover simple low-competition websites with 10k-100k monthly visits, score them by a weighted rubric, clone the concept (not content) with AI-generated code and copy, deploy cheaply, monetize via ads and affiliates, and scale to a 20-site portfolio generating $10k+/mo within 12 months.

## The Claim in First-Principles Physics

The plan's thesis reduces to four mechanisms, any of which failing invalidates the loop:

- **M1 (information asymmetry):** you can find profitable niches before saturation occurs.
- **M2 (execution arbitrage):** you can ship a ranked clone faster than competitors react.
- **M3 (pattern transferability):** winner formulas transfer across niches.
- **M4 (distribution economics):** organic SEO is a free distribution channel.

All four were structurally true in 2018-2022. The evidence below shows three of them are broken in 2026 and the fourth requires a redefinition.

---

## Atomic Premise Map

Each premise stated as the plan implicitly claims, then tagged with 2025-2026 evidence.

| # | Premise (as plan claims) | Status | Evidence |
|---|---|---|---|
| A1 | Profitable boring sites are discoverable via Ahrefs/SEMrush/Reddit/PH | **Weakens** | Keyword tools give same data to everyone → discovery commoditized. Reddit still surfaces real pain 3-6mo ahead but needs human curation, not scraping. |
| A2 | 10k-100k/mo traffic is the monetizable sweet spot | **Broken** | Mediavine requires 50k sessions minimum; $10k/mo at realistic RPMs ($22-57) needs **250k-666k** monthly sessions — an order of magnitude above plan's target band. |
| A3 | Opportunity score (Traffic × Monetization × Replicability × Demand) / Competition predicts success | **Broken** | Inputs are SEO-tool estimates with ±50% error. No feedback loop. Score provides false precision. Replicability ≠ ranks. |
| A4 | Top-5 competitor gap analysis reveals exploitable openings | **Broken** | Post-HCU, Google favors incumbents with brand signals. AI-authored content filling "content gaps" trips spam detection. The gap exists because filling it is penalized, not because no one thought of it. |
| A5 | Google Trends + keyword databases indicate sustained demand | **Partial** | Still works for demand *shape*, not level. Absolute volumes distorted by AI Overviews collapsing the traffic floor. |
| A6 | "Concept clone, not content" differentiates enough to rank | **Broken** | AI Overviews answer the query before any result is clicked. Concept-cloning produces zero-click-visible sites. Without unique data, AIO is the ranking. |
| A7 | AI (Claude/GPT) generates production-ready code + SEO content that ranks | **Half-broken** | Code generation: works, production-ready. Content generation: sites with >30% unedited AI content deindexed within 3-6 months per documented cases. HCU + March 2026 "Information Gain" explicitly score for proprietary data and demote rewritten competitor content. |
| A8 | Near-zero hosting/deployment cost (Vercel/Netlify) | **Holds** | True. $325-2k launch, $50-200/mo marginal. This is the only mechanical assumption unchanged. |
| A9 | Multiple revenue streams (ads + affiliates + products) compound | **Weakens** | Attention is zero-sum; layered monetization reduces each stream's performance. Amazon affiliate cuts + FTC enforcement + HCU review-page demotion all bit in 2024. |
| A10 | Adsense / Mediavine RPMs sustain plan economics | **Partial, math is wrong** | Raptive Q4 2025: $34-57 RPM. Mediavine average: $22-44. At these RPMs, $10k/mo across 20 sites requires ~250k+ sessions each — 5x the plan's stated 50k-ish target. |
| A11 | Affiliate scales linearly with traffic | **Broken** | Google reviews/product update 2023+ demoted thin affiliate content. Site-reputation-abuse manual actions hit even Forbes Advisor and WSJ Buy Side in 2024. |
| A12 | Portfolio of 20 thin sites averages to $500/mo each → $10k | **Broken** | Risk is correlated across the portfolio: one Google update hits all 20. Median indie-project MRR is $500/mo; mean is $5,768 driven by power-law outliers. 20 random clones is not "average $500"; it's "most fail, one might hit." |
| M1 | Automation reduces marginal cost to near-zero | **Broken** | Ahrefs API for programmatic use: $1,499/mo enterprise. SimilarWeb API: $167+/mo. SEMrush Business: $499/mo. Realistic discovery-loop tooling: $300-2k/mo *before any site is built*. |
| M2 | Google treats 20 sites from one operator as independent | **Broken** | Shared Adsense, Analytics, hosting IPs, schema fingerprints cluster sites. Cross-site manual actions documented. The old PBN risk applies to AI-clone portfolios. |
| M3 | The winner's circle stays open to clone entrants | **Broken** | 2023-2024 AI gold rush glutted SERPs before Google's countermeasures. Median niche with >5k searches is now saturated or explicitly penalized. |

---

## What the Plan Does Not Mention (and Must)

Threat surfaces absent from the document:

- **AI Overviews.** Zero mention. This is the single largest structural change to organic tool/calculator traffic since Google existed. The plan's primary target SERPs are the ones AIO cannibalizes most.
- **Information Gain ranking signal** (March 2026 Google core update). Google now explicitly scores pages on proprietary data, first-hand evidence, original frameworks, expert attribution, freshness. Sites rewriting competitor content are actively demoted. The plan proposes exactly this.
- **LLM citation as a distribution channel.** AI-referred traffic grew 527% in 2025. Brand search volume is the strongest predictor of LLM citations (0.334 correlation), ahead of backlinks. Clone sites with zero brand search are invisible to the fastest-growing traffic source.
- **Tooling cost floor.** Plan says "SEO API" as if one line item. Real cost: $300-2k/mo for programmatic access. At 20 sites, this is $18k-120k/yr overhead not budgeted.
- **Time-to-rank reality.** New domain sandbox + DA building = 12-24 months to meaningful ranking for any competitive niche. Plan implies weeks.
- **Site-reputation-abuse manual actions.** Google now issues manual penalties for thin/scaled content on individual sites. Portfolio ownership amplifies cross-site blast radius.

---

## What the 2025-2026 Data Says Actually Works

Converging across three research sources:

### Survival mechanics (HCU + Information Gain era)

- Proprietary data (survey, benchmark, live API aggregation) + interactive tool = double moat
- <30% AI-authored content; human editorial review at minimum on high-intent pages
- Niches that reward interaction or real-time data (AIO can't fully replace): sports scores, financial calculators requiring user inputs, weather, live rates
- Single-domain depth beats multi-domain shallow (Berkshire > index fund when risk is correlated)

### Distribution mechanics

- **Brand search volume** is now the terminal metric: predicts organic, AIO, and LLM-citation distribution simultaneously
- Reddit is top-5 cited domain on ChatGPT, Google AI Mode, and Perplexity. Genuine participation → compounding discovery advantage
- Community-first (Discord/newsletter of 30-100 before site launch) → brand search seed → LLM citation + organic
- Multi-language arbitrage: 60%+ of searches non-English; most tools English-only. German/Portuguese/Spanish calc/template niches remain low-competition

### Monetization mechanics

- **Freemium micro-SaaS** (free tool → $20-100/mo paid tier): 41% avg profit margin; acquisition multiple 40-60x monthly vs content's 28-38x. AIO cannot replace a logged-in stateful tool.
- **Lead-gen** in B2B niches (contractor software, local services) pays $20-200/lead. Resists commoditization because of qualification + relationship.
- Display ads: viable but the math is the inverse of the plan. At Mediavine RPM $30, 1 good site at 300k sessions = $9k/mo, and is 5x less risky than 20 at 30k.

### Case data

- **Dead:** throughtheclutter.com — peaked 1M/mo, collapsed to near-zero in one week post-HCU.
- **Dead:** FreshersLive, Far & Away — Pure Spam manual action, full deindex 2024.
- **Alive:** Nomad List ($47k/mo) — decade of brand + live proprietary data.
- **Alive:** Zapier programmatic pages — 70k pages, 6.3M monthly visits; each page backed by the proprietary integration graph.
- **Exited well:** unnamed AI tool directory $25k/mo → $944k sale. Curated dataset, not content clone.

---

## 2026-Viable Redesign (derived from first principles, not from editing the plan)

If the goal is a single operator using AI and automation to build boring-but-profitable web assets in 2026, the loop the data supports:

### DISCOVER — unresolved-pain listening, not keyword-gap scraping

- Reddit / Discord / niche-forum signal extraction — pain phrases 3-6mo ahead of keyword tools
- LLM citation gaps — queries where ChatGPT/Perplexity cite weak sources, indicating a dataset opportunity
- Proprietary-data-arbitrage search — subjects with scattered data nobody has aggregated

### VALIDATE — AIO-resistance first, not traffic estimate

Gate each candidate on:

1. Does the query class *require interaction or user state*? (If Google can AIO-answer it, kill.)
2. Is there a dataset you can uniquely aggregate or produce?
3. Is the community narrow enough that brand search is achievable for <$10k?
4. Multi-language arbitrage available?
5. Unit economics to $1-5k MRR first — not $500 from ads

### BUILD — product-first, brand-first, not content-first

- Ship interactive tool (not content pages) as the core
- Collect proprietary data before or during launch (survey, scrape primary sources, API aggregation of a unique slice)
- Community-first: 30-100 founding users in a Discord/newsletter *before* the SEO site lights up — seeds brand search
- One quality English site + 2-3 non-English mirrors > twenty English clones
- Structure for LLM citation: H2/H3/bullet format, stats + direct quotations, quarterly freshness, expert attribution

### MONETIZE — product > ads, at 2x exit multiple

- Free tool with $20-100/mo paid tier (micro-SaaS) — resists AIO, compounds brand, 40-60x exit
- API-as-product for the underlying data
- Lead-gen in B2B/local niches where $50+ per lead is real
- Ads only as secondary on mature sites clearing 50k sessions

### PORTFOLIO STRATEGY

- 2-3 deep assets, not 20 thin ones. HCU-correlated risk means diversification-by-quantity is not protective.
- Each asset either: (a) owns proprietary data, (b) has stateful interactive tool, or (c) has community-backed brand search. Anything else is HCU-vulnerable.

---

## Open Questions (for user decision before any build)

These are not obvious from the plan or the evidence; the answers reshape the whole approach.

1. **Time horizon.** Are you optimizing for $10k MRR in 12 months (plan's framing, now unrealistic), or $10k MRR in 24-36 months on 2 assets with exit optionality? The second is supported by the 2026 mechanics; the first is not.
2. **Edge.** Do you have domain expertise (industry, hobby, language, geography) in any niche? Without an edge, competing with operators who do is materially harder in 2026 than in 2020.
3. **Ads-only vs product-led.** Commit up front. Building for both dilutes both.
4. **Discovery signal.** Reddit listening, LLM citation gap analysis, and proprietary-dataset hunting are three very different skill sets. Which are you willing to operate?
5. **Build vs buy.** Empire Flippers / Flippa price existing assets at 28-38x monthly. Is buying a survivor cheaper than building from zero, given 18-36mo time-to-stability?

---

## Where the Plan Still Has Value

Not zero. Specifically:

- **Part 4 (DB schema)** is reasonable shape for tracking opportunities, regardless of which discovery mechanism is used. Keep.
- **Part 9 (risk table)** is directionally right but understates algorithm-correlation risk. Expand.
- **Part 10 (success criteria)** — the 3/6/12mo milestones are unrealistic at the revenue levels stated, but the *structure* of staged milestones with kill criteria is sound.
- **"Quick Start: Manual Discovery"** is actually better grounded than the automation ambition. Start here, learn the domain, then decide what to automate.

---

## Sources

**Plan-premise evidence:**
- Ahrefs: AI Overviews Reduce Clicks by 58% — https://ahrefs.com/blog/ai-overviews-reduce-clicks-update/
- Seer Interactive: AIO Impact on Google CTR — https://www.seerinteractive.com/insights/aio-impact-on-google-ctr-september-2025-update/
- Google Search Central: March 2024 Core Update + Spam Policies — https://developers.google.com/search/blog/2024/03/core-update-spam-policies
- NicheInvestor: Are Niche Sites Still Profitable in 2025 — https://nicheinvestor.com/are-niche-sites-still-profitable/
- IndieLaunches: Indie Maker Analytics 2024-2025 — https://indielaunches.com/indie-maker-analytics-2024-2025-projects/
- The Digital Bloom: 2025 Organic Traffic Crisis Analysis — https://thedigitalbloom.com/learn/2025-organic-traffic-crisis-analysis-report/

**2026 mechanics:**
- Digital Applied: Information Gain — Google's #1 Ranking Signal 2026 — https://www.digitalapplied.com/blog/information-gain-google-ranking-signal-april-2026
- Digital Applied: March 2026 Core Update Winners & Losers — https://www.digitalapplied.com/blog/march-2026-core-update-content-quality-winners-losers/
- Superprompt: AI Traffic Up 527% in 2025 — https://superprompt.com/blog/ai-traffic-up-527-percent-how-to-get-cited-by-chatgpt-claude-perplexity-2025
- Semrush: Most-Cited Domains in AI — https://www.semrush.com/blog/most-cited-domains-ai/
- Ahrefs: Top Cited Domains Across ChatGPT, Perplexity, Gemini, Google AI — https://ahrefs.com/blog/top-10-most-cited-domains-ai-assistants/
- Flippa: 2025 Online Business M&A Insights — https://flippa.com/blog/2025-online-business-ma-insights-from-flippa/
- TheWebsiteFlip: 23 Profitable Niches from Mediavine & Raptive Sites — https://thewebsiteflip.com/guide/profitable-niches-raptive-mediavine/
- Kevin Indig: Case Study — AI Content Punished by HCU — https://www.kevin-indig.com/case-study-ai-content-punished-by-the-hcu-update/
- Buska: Reddit Social Listening 2026 — https://www.buska.io/blog/reddit-social-listening-2026

**Tooling cost reality:**
- SeoBotAI: Ahrefs API Pricing & Alternatives — https://seobotai.com/blog/ahrefs-api-alternatives/
- Zumeirah: Programmatic SEO in 2026 — https://zumeirah.com/programmatic-seo-in-2026/
