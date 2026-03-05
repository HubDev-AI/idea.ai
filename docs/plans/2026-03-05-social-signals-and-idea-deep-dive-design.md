# Social Signal Sources + Idea Deep-Dive Feature

**Date:** 2026-03-05
**Status:** Approved
**Branch:** TBD (from dev)

## Problem

1. The sixth sense flow produces mostly developer/B2B ideas because 12 of 15 connectors are tech-focused (HN, GitHub, ShowHN, Lobsters, DevTo, etc.). No consumer/social signal sources exist.
2. There is no way to get more detail about a thesis (Top Idea) beyond the card summary. Users want to click a thesis and see AI-generated insights without leaving the dashboard.

## Solution Overview

Three workstreams:

### A. New Consumer/Social Connectors

| Connector | Source | Signal Type | Cadence |
|-----------|--------|------------|---------|
| `google_trends` | Google Trends RSS feeds | Trending consumer search topics | daily |
| `tiktok_creative` | TikTok Creative Center public data | Trending hashtags/topics with engagement | daily |
| `alternativeto` | AlternativeTo.net RSS/scrape | "I want an alternative to X" demand signals | daily |

Each connector implements `fetch<Name>(limit: number): Promise<RawEventInput[]>` and is registered in `OPEN_CONNECTOR_CADENCE` and `OPEN_CONNECTOR_LIMITS`.

### B. Agent Prompt Tuning (Strong Consumer Focus)

**Broad Scan prompt changes:**
- Add cross-pollination instruction: when seeing consumer trends (Google Trends, TikTok), derive software product ideas a solo founder could build
- Add diversity constraint: at least 1 dig_deeper topic must target a consumer/social product, not developer tooling
- Require specific growth mechanics in virality assessments (not just "has potential")
- Bias toward consumer social apps, prosumer tools, community platforms
- Deprioritize enterprise/B2B/developer tooling unless signal is exceptionally strong

**Deep Dive prompt changes:**
- Require description of the "sharing moment" for consumer ideas
- Bias toward small scope (solo founder, 1-2 month MVP) with viral distribution
- Ask for specific user acquisition channels and organic growth loops

### C. Thesis Deep-Dive Feature

#### Database

```sql
CREATE TABLE thesis_deep_dives (
  id BIGSERIAL PRIMARY KEY,
  canonical_key TEXT NOT NULL UNIQUE REFERENCES thesis_candidates(canonical_key),
  summary TEXT NOT NULL,
  how_it_works TEXT NOT NULL,
  growth_strategy TEXT NOT NULL,
  build_suggestions TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### API

- `GET /v1/theses/:key/deep-dive` -- returns cached deep-dive or 404
- `POST /v1/theses/:key/deep-dive` -- generates via AI (primary + fallback), stores, returns

Rate limit: 30 req/min on POST (AI generation is expensive).

#### AI Generation Prompt

```
Given this product thesis:
- Title: {title}
- Problem: {problemStatement}
- Target buyer: {targetBuyer}
- Proposed solution: {proposedSolution}
- Confidence: {confidence}%

Generate a concise deep-dive analysis. Keep each section 2-4 sentences max.
Focus on actionability -- what would a solo founder need to know?

Return ONLY valid JSON:
{
  "summary": "What this idea is and why it matters right now",
  "how_it_works": "Key features and core user experience",
  "growth_strategy": "How users discover and share this product -- specific viral mechanics",
  "build_suggestions": "Recommended tech stack, MVP scope, and first 3 steps to validate"
}
```

Provider routing: `claude -p` primary, `codex exec` fallback (same as agent runner).

#### Frontend

**Modal component** (`ThesisDeepDiveModal.tsx`):
- Opens when ThesisCard is clicked
- Shows loading skeleton while AI generates
- Displays 4 sections: Summary, How it works, Growth strategy, Build suggestions
- Cached results load instantly on repeat clicks
- Close on X, Escape, or backdrop click
- Follows existing dark theme with Geist font

**State management:**
- Local state in App.tsx: `selectedThesisKey: string | null`
- Fetch deep-dive data on modal open
- Cache in a `Map<string, DeepDiveResult>` to avoid refetching within session

## Implementation Order

1. DB migration for `thesis_deep_dives`
2. Deep-dive API endpoints (GET + POST)
3. Deep-dive AI generation logic
4. Frontend modal component + API client
5. New connectors: google_trends, tiktok_creative, alternativeto
6. Agent prompt tuning
7. Integration testing

## Non-Goals

- No changes to the signal feed display
- No changes to scoring weights
- No changes to existing connector behavior
- No user accounts or auth
