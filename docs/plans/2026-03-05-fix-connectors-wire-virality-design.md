# Fix Connectors + Wire Virality Scoring

## Problem

1. Product Hunt connector requires OAuth API token (`PH_API_TOKEN`) — returns empty when not set
2. Virality scores from AI post-scrape are computed and parsed but hardcoded to 0 in the scoring pipeline, making the 35% virality weight dead

## Changes

### 1. Product Hunt: RSS feed instead of GraphQL API

Replace `packages/connectors/src/producthunt.ts` — swap GraphQL + OAuth for public RSS feed (`https://www.producthunt.com/feed`). Same pattern as `indiehackers.ts` (XML parse with `withRetry`). Remove `PH_API_TOKEN` dependency.

### 2. Wire virality scores end-to-end

Two files, two changes:

- `apps/api/src/runtime/live_read_model.ts` ~line 828: `virality: 0` -> `virality: aiInsight?.virality ?? 0`
- `packages/pipeline/src/jobs/score.ts` ~line 54: pass AI insight virality instead of hardcoded 0

The AI post-scrape prompt already asks for virality (0-100), the parser extracts it, the blend formula weights it at 35%. Only the handoff is missing.

### 3. No changes

- Reddit, IndieHackers, App Store Trending, YC Companies — all functional
- Twitter/X stays BYO (needs user's API key)
- Blend weights stay at demand 25%, timing 20%, buildability 20%, virality 35%

## Files touched

| File | Change |
|------|--------|
| `packages/connectors/src/producthunt.ts` | Rewrite: RSS feed |
| `apps/api/src/runtime/live_read_model.ts` | Wire `aiInsight.virality` |
| `packages/pipeline/src/jobs/score.ts` | Wire virality to `blendedScore()` |
| `.env.example` | Remove `PH_API_TOKEN` |
| Tests for above | Update assertions |
