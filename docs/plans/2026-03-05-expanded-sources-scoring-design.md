# Expanded Data Sources + Scoring Intelligence Design

**Date**: 2026-03-05
**Status**: Approved
**Goal**: Expand idea.ai from 9 to 15+ connectors with emphasis on social/viral consumer apps and small dev tooling, plus scoring intelligence improvements for cross-source signal correlation.

## Context

Current connectors: HN, GitHub Issues, Reddit, YC Companies, Product Hunt, App Store Trending, IndieHackers, Greenhouse, Lever. Virality scoring now wired end-to-end (PR #24). Need more sources and smarter scoring to detect viral/social opportunities.

Research completed in `docs/research/2026-03-05-new-data-sources-dev-tools.md` — 20 sources evaluated across 4 tiers.

## Phase 1: Quick-Win Connectors (6 new sources)

### 1.1 Mastodon Trends (fosstodon.org + hachyderm.io)
- **Why**: Developer community migrated from Twitter; authentic pain points and tool recommendations
- **API**: `GET /api/v1/timelines/tag/{tag}?limit=40` — no auth, public timelines
- **Tags**: `#devtools`, `#cli`, `#opensource`, `#programming`, `#buildinpublic`, `#indiedev`
- **Instances**: fosstodon.org (49k users, FOSS-focused), hachyderm.io (tech-industry)
- **Signal**: reblogs_count + favourites_count as engagement proxy
- **Cadence**: daily
- **Pattern**: Same as existing connectors — `fetchMastodonEvents(loader, limit)`

### 1.2 Lobsters (lobste.rs)
- **Why**: Invite-only dev community, higher signal-to-noise than HN for technical content
- **API**: Append `.json` to any page — `/hottest.json`, `/t/devops.json`
- **Signal**: score + comment_count
- **Cadence**: daily (hottest + tag-specific)
- **Pattern**: Simplest connector — JSON array, no auth

### 1.3 HN Show HN Enhancement
- **Why**: Show HN = developer tool launches with community validation. We already have HN but don't filter for launches.
- **API**: Algolia `tags=show_hn&numericFilters=points>15`
- **Signal**: points + num_comments (already validated by upvotes)
- **Cadence**: hourly (alongside existing HN connector)
- **Pattern**: Enhancement to existing HN connector or separate `showhn` source

### 1.4 Bluesky Trending
- **Why**: Growing developer community, real-time pulse
- **API**: Public search endpoint `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q={query}&limit=25`
- **Queries**: "building in public", "launched my app", "side project", "dev tool", "open source"
- **Signal**: likeCount + repostCount
- **Cadence**: daily
- **Pattern**: REST JSON, same as other connectors

### 1.5 Dev.to (Forem) API
- **Why**: Developer articles with engagement metrics, tag-based filtering for devtools/cli/productivity
- **API**: `GET /api/articles?tag=devtools&top=7` — no auth required
- **Signal**: public_reactions_count + comments_count
- **Cadence**: daily
- **Pattern**: Standard REST JSON

### 1.6 Homebrew Analytics
- **Why**: Actual CLI tool adoption data (not discussion). Compare 30d vs 90d to detect rapidly rising tools.
- **API**: Static JSON `https://formulae.brew.sh/api/analytics/install-on-request/30d.json`
- **Signal**: install count deltas between snapshots
- **Cadence**: weekly
- **Pattern**: Fetch JSON, diff against previous snapshot stored in DB

## Phase 2: Package Registries (4 sources)

### 2.1 Google Play Scraper (via web)
- **Why**: Trending Android apps reveal consumer/viral opportunities
- **API**: Scrape trending/new apps from Play Store web or use `google-play-scraper` npm package
- **Cadence**: daily

### 2.2 npm Registry Search
- **Why**: New CLI tools and developer utilities with popularity/quality scores
- **API**: `GET /-/v1/search?text=keywords:cli+tool&popularity=1.0&size=25`
- **Cadence**: daily

### 2.3 PyPI RSS
- **Why**: Stream of new Python packages — many CLI tools, MCP servers, AI tools
- **API**: RSS `https://pypi.org/rss/packages.xml`
- **Cadence**: daily, keyword-filtered

### 2.4 crates.io + lib.rs
- **Why**: Rust ecosystem = CLI tool goldmine (ripgrep, fd, bat, etc.)
- **API**: REST JSON `https://crates.io/api/v1/crates?sort=new&per_page=25`
- **Cadence**: daily

## Phase 3: Community Intelligence (4 sources)

### 3.1 Lemmy (lemmy.world, programming.dev)
- **Why**: Federated Reddit alternative with developer communities
- **API**: Lemmy REST API, no auth for reads

### 3.2 GitHub Trending
- **Why**: Direct measure of what devs are excited about NOW
- **API**: HTML scrape `github.com/trending?since=daily`

### 3.3 Stack Overflow Hot Questions
- **Why**: High-vote unanswered questions = unsolved developer problems
- **API**: Stack Exchange API, gzip responses

### 3.4 TrackAwesomeList
- **Why**: Curated additions to awesome-lists = community-vetted tools
- **API**: Atom feeds per awesome-list

## Scoring Intelligence Improvements

### Multi-Source Convergence Boost
When the same concept appears from 2+ different sources within a 48h window, boost the virality score by 15-25 points. Detection via embedding similarity (cosine distance < 0.3) across recent signals.

**Implementation**: After indexing a new signal, query `signal_embeddings` for similar signals from different sources within the time window. If matches found, UPDATE the virality score of both signals.

### Engagement-Weighted Signals
Sources that provide engagement metrics (upvotes, stars, reactions) should weight signal scores accordingly:
- Low engagement (< 10 reactions): no boost
- Medium engagement (10-50): +5 to demand
- High engagement (50-200): +10 to demand, +5 to virality
- Viral engagement (200+): +15 to demand, +10 to virality

**Implementation**: Add optional `engagement_count` field to `RawEventInput`. Use in `scoreSignal()` to adjust base scores.

### Launch Detection Tagging
Signals that represent actual product/tool launches (Show HN, Product Hunt, new npm/crate packages) get a `is_launch: true` tag. Launches receive +10 timing score since they represent actionable market moves.

**Implementation**: Add `is_launch` boolean to signal metadata. Set by connector based on source type. Feed into scoring pipeline.

## Connector Architecture

All new connectors follow the established pattern:
```typescript
// packages/connectors/src/{source}.ts
export const fetch{Source}Events = async (
  loadEvents: LoaderFn = defaultLoader,
  limit = OPEN_CONNECTOR_LIMITS.{source}
): Promise<RawEventInput[]> => { ... }
```

Registration in:
- `packages/connectors/src/common/http.ts` — add to `OPEN_CONNECTOR_LIMITS` and cadence
- `apps/api/src/jobs/ingest_open.ts` — add to ingestion orchestrator
- `apps/api/src/runtime/live_read_model.ts` — add to `enabledOpenConnectors`
- `apps/web/src/Sidebar.tsx` — add display name

## Data Flow

```
New Connector → RawEventInput[] → ingest_open.ts → AI post-scrape
  → scoreSignal (with engagement boost) → indexSignalMemory
  → convergence check → virality boost if cross-source match
  → signal_memory + signal_embeddings (PostgreSQL)
  → API /feed → Web dashboard
```

## Testing Strategy

- Unit tests per connector with mock loader (same pattern as existing tests)
- Integration test for convergence boost logic
- Manual verification via API `/health/connectors` and dashboard

## Success Criteria

- 15+ active connectors returning data
- Cross-source convergence detection working (visible in signal scores)
- Engagement metrics flowing through scoring pipeline
- All existing tests continue to pass

## Files Touched (estimated)

| Area | Files |
|------|-------|
| New connectors | 6 new files in `packages/connectors/src/` |
| Connector tests | 6 new files in `packages/connectors/tests/` |
| Registration | `common/http.ts`, `ingest_open.ts`, `live_read_model.ts` |
| Contracts | `RawEventInput` type (add engagement_count) |
| Scoring | `score.ts`, `blend.ts` (engagement boost) |
| Memory | `postgres_memory_store.ts` (convergence query) |
| UI | `Sidebar.tsx` (display names) |
