# Social/Viral Expansion Design

**Date:** 2026-03-01
**Status:** Approved

## Context

The Sixth Sense engine currently focuses on enterprise/dev tooling SaaS opportunities — its connectors watch Hacker News, GitHub Issues, Reddit (SaaS/startup subs), job boards, YC, and Product Hunt. The AI scoring is tuned for B2B pain points with a "solo dev builds in 1-3 months" filter.

The goal is to broaden the system to detect **viral and social app opportunities** — consumer social, prosumer tools with network effects, community-driven products — in addition to enterprise SaaS.

## Approach: Source Expansion + Scoring Overhaul

Three changes: (1) add new signal sources, (2) rework the scoring model, (3) update AI prompts.

## 1. New Connectors

### 1.1 Twitter/X Trending (BYO)

- **Source key:** `twitter_trending`
- **API:** X API v2 (`GET /2/tweets/search/recent`)
- **Gate:** `X_BEARER_TOKEN` env var (BYO connector with budget guard)
- **Cadence:** hourly
- **Captures:** Trending topics, viral threads with high engagement, complaint/wishlist threads
- **Query strategy:** Search for product complaints, "someone should build", "wish there was an app", startup launches with high retweet velocity
- **Limit:** 25 per fetch

### 1.2 TikTok Trending

- **Source key:** `tiktok_trending`
- **API:** TikTok Research API (requires approval) or third-party trends API
- **Gate:** `TIKTOK_API_KEY` env var (BYO)
- **Cadence:** daily
- **Captures:** Trending sounds/effects, creator pain points, viral content formats
- **Fallback:** If no API key, scrape TikTok trending page via headless browser
- **Limit:** 20 per fetch

### 1.3 App Store Trending

- **Source key:** `appstore_trending`
- **API:** iTunes RSS feed (free, no auth) + Google Play scraper (open source)
- **Cadence:** daily
- **Captures:** New trending apps, top movers by category, review pain points from top apps
- **Categories to watch:** Social, Productivity, Lifestyle, Entertainment, Communication
- **Limit:** 30 per fetch (combined iOS + Android)

### 1.4 IndieHackers

- **Source key:** `indiehackers`
- **API:** RSS feed / HTML scrape
- **Cadence:** daily
- **Captures:** Maker launches, revenue milestones, "building in public" threads, product ideas
- **Limit:** 20 per fetch

### 1.5 Reddit Consumer Subreddits

- **Source key:** `reddit` (existing connector, expanded config)
- **New subreddits added to default `REDDIT_SUBREDDITS`:** r/apps, r/socialmedia, r/productivity, r/dating, r/sideproject, r/AppIdeas, r/InternetIsBeautiful
- **Combined default:** `SaaS,startups,smallbusiness,Entrepreneur,apps,socialmedia,productivity,dating,sideproject,AppIdeas,InternetIsBeautiful`
- **Limit per sub stays:** 25

### 1.6 Existing Connector Changes

- **Job boards (Greenhouse, Lever):** Move to opt-in. Add `ENABLE_JOB_CONNECTORS=true` env var, default to disabled.
- **All other connectors** (HN, GitHub, PH, YC, Reddit, Exa, Perigon) stay active — they catch viral B2B and social signals too.

## 2. Scoring Model Overhaul

### 2.1 Four-Dimension Scoring

| Dimension | Replaces | Weight | What it measures |
|-----------|----------|--------|-----------------|
| **Demand** | Pain | 25% | How strongly people want this — complaints, wishlists, spending intent, download velocity |
| **Timing** | (same) | 20% | Market readiness — trending NOW, enabling tech mature, competition sparse |
| **Buildability** | (same) | 20% | Technical feasibility — can a team ship an MVP |
| **Virality** | (new) | 35% | Network effects, shareability, word-of-mouth, inherent growth loops |

**Blended formula:** `demand * 0.25 + timing * 0.20 + buildability * 0.20 + virality * 0.35`

### 2.2 Virality Scoring Guide

- **80-100:** Strong inherent network effects (messaging, social, marketplace). Sharing IS the product.
- **60-79:** Natural word-of-mouth. Community-driven growth. Users bring other users.
- **40-59:** Some viral mechanics possible (referral programs, sharing features) but not core.
- **20-39:** Primarily organic/content marketing driven.
- **0-19:** Pure sales/outbound driven. No natural distribution.

### 2.3 Demand Scoring Guide

Same as current "pain" scoring but broadened:
- Complaints about existing products (pain)
- Wishlist requests ("I wish there was...")
- Spending intent ("I'd pay for...")
- Download/usage velocity of related apps
- Community size and engagement around the problem space

## 3. AI Prompt Changes

### 3.1 Post-Scrape Analyst

**Persona change:** "SaaS opportunity analyst" → "product opportunity analyst specializing in viral and high-growth products"

**Output schema change:** Add `virality` (0-100) field. Rename internal `pain` → `demand`.

**Signal scope:** Include consumer apps, social platforms, viral tools, B2B products with network effects, and community-driven products. Not just SaaS.

### 3.2 Buildability Judge

- Remove "solo dev" language from prompt
- Keep 3-judge consensus mechanism (works for any product type)

### 3.3 Research Agent — Broad Scan

- **Remove:** "Products must be buildable by a solo dev in 1-3 months"
- **Add to thesis criteria:** "Assess virality potential — does this idea have inherent network effects, sharing mechanics, or community-driven growth loops?"
- **Add to thesis output:** `virality_assessment` field (1-2 sentence explanation of growth loop)
- **Broaden examples:** Include consumer and social app examples alongside SaaS

### 3.4 Research Agent — Deep Dive

- Add signal velocity context (how fast is this topic growing across sources?)
- Ask agent to evaluate growth loop mechanics in thesis proposals
- Include cross-platform signal correlation (same trend appearing on Reddit + TikTok + App Store = high signal)

## 4. Database Migration

### 4.1 Schema Changes

```sql
-- Rename pain → demand (preserves existing scores)
ALTER TABLE signal_memory RENAME COLUMN pain TO demand;

-- Add virality column
ALTER TABLE signal_memory ADD COLUMN virality INTEGER;

-- Update scoring weights config (if stored in DB)
-- Otherwise handled in code via blend.ts
```

### 4.2 Type Changes

- `FeedRecord`: `pain?: number` → `demand?: number`, add `virality?: number`
- `RawScoredEvent` in pipeline: same changes
- `ScoreTriplet` in `dual_analyst.ts`: becomes `ScoreQuad` with `virality` added
- `reconcileScores`: handle 4 dimensions instead of 3

### 4.3 Backward Compatibility

- Old signals: `demand` column has their former `pain` scores (valid — pain is a form of demand)
- Old signals: `virality` is null → UI shows no viral chip (existing null-check handles this)
- Old theses: keep existing scores, new runs will add virality assessments

## 5. UI Changes

### 5.1 Signal Row

- Breakdown chips: "Pain" → "Demand", add "Viral" chip (green tint for high, neutral for low)
- Score display stays the same (blended 0-100)

### 5.2 Thesis Card

- Add virality indicator if present (network icon + score)
- Remove scope badge constraint (no longer filtering by solo-dev scope)

### 5.3 Sidebar

- Signal counts stay grouped by source
- New source badges appear automatically as connectors are added

## 6. Implementation Scope

Estimated 3 PRs:
1. **PR1 — Scoring overhaul:** DB migration, type changes, blend formula, AI prompt updates, UI chip renames
2. **PR2 — New connectors:** Twitter, TikTok, App Store, IndieHackers, expanded Reddit subs, job board opt-in
3. **PR3 — Agent intelligence:** Research agent prompt updates, virality assessment in theses, cross-platform correlation

## 7. Non-Goals

- Real-time streaming (stay with polling cadence)
- Sentiment analysis engine (AI judges handle this implicitly)
- User accounts / multi-tenant (single-user tool)
- Paid API aggregators beyond existing BYO pattern
