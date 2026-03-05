# Research: New Data Sources for Detecting Developer Tooling Opportunities

**Date**: 2026-03-05
**Status**: Complete
**Goal**: Identify free/low-cost data sources that reveal developer pain points, trending dev tools, workflow gaps, and small-tool opportunities for idea.ai

**Currently ingesting from**: HN, GitHub Issues, Greenhouse, Lever, YC Companies, Reddit, Product Hunt, App Store Trending, IndieHackers

---

## TIER 1 -- HIGH SIGNAL, EASY IMPLEMENTATION

These sources have verified free JSON APIs, strong developer-tool signal, and can be built in 1-2 days each.

---

### 1. Dev.to (Forem) API

- **URL**: https://dev.to/api/articles
- **What it provides**: Developer-authored articles with engagement metrics. Filtering by tags like `devtools`, `cli`, `productivity`, `opensource` surfaces pain-point discussions and new tool announcements.
- **Access method**: REST JSON API, no auth required for reads
- **Endpoint examples**:
  - `GET /api/articles?tag=devtools&top=7` -- top devtools articles this week
  - `GET /api/articles?tag=cli&top=30` -- top CLI articles this month
  - `GET /api/articles?tag=productivity&per_page=30` -- latest productivity posts
- **Fields**: title, description, url, tags, public_reactions_count, comments_count, published_at, reading_time_minutes, user (with github_username)
- **Rate limits**: 10 req/30s unauthenticated, 30 req/30s with API key (free)
- **Signal quality**: HIGH -- authors describe real pain points, announce tools, and community engagement (reactions/comments) acts as quality filter
- **Implementation**: EASY -- standard REST JSON, same pattern as existing connectors
- **Recommended cadence**: Daily, fetch top articles by tag for last 7 days

---

### 2. Lobsters (lobste.rs) JSON API

- **URL**: https://lobste.rs/
- **What it provides**: Computing-focused link aggregation with high-quality submissions. Tag filtering for devops, programming, practices, etc. Higher signal-to-noise ratio than HN for technical content.
- **Access method**: Native JSON API (append .json to any page)
- **Endpoint examples**:
  - `GET /hottest.json` -- 25 hottest stories
  - `GET /newest.json` -- 25 newest stories
  - `GET /t/devops.json` -- stories tagged devops
  - `GET /t/devops,programming.json` -- multi-tag combo
- **Fields**: short_id, title, url, score, comment_count, tags[], submitter_user, created_at, description, user_is_author
- **Rate limits**: Not documented, be polite (1 req/sec recommended)
- **Signal quality**: HIGH -- invite-only community of experienced developers, curated tags, high-quality submissions focused on systems, CLIs, devops
- **Implementation**: EASY -- simple JSON arrays, same pattern as HN connector
- **Recommended cadence**: Hourly for /hottest.json, daily for tag-specific

---

### 3. Homebrew Install Analytics

- **URL**: https://formulae.brew.sh/api/analytics/
- **What it provides**: Real install counts for every Homebrew formula, broken down by 30/90/365 day windows. Directly measures which developer CLI tools macOS/Linux developers are actually installing.
- **Access method**: Static JSON files, no auth, no rate limit
- **Endpoint examples**:
  - `GET /api/analytics/install-on-request/30d.json` -- 30-day install-on-request
  - `GET /api/analytics/install-on-request/90d.json` -- 90-day install-on-request
  - `GET /api/formula/{name}.json` -- individual formula details + analytics
- **Fields**: formula name, count, percentage, start_date, end_date, total_items (34,780 formulae tracked)
- **Rate limits**: None (static JSON files served from CDN)
- **Signal quality**: VERY HIGH -- actual adoption data, not just discussion. Measures real developer tool usage. The 90-day top 10 (gh, awscli, node, uv, ffmpeg, git, go, gemini-cli, cmake, coreutils) directly maps to developer tooling trends.
- **Implementation**: EASY -- fetch JSON, diff against previous snapshot to detect rising tools
- **Recommended cadence**: Weekly (data is aggregated over 30/90/365 day windows)
- **Key insight**: Compare 30d vs 90d rankings to detect rapidly rising tools (e.g., uv climbing, gemini-cli appearing)

---

### 4. npm Registry Search API

- **URL**: https://registry.npmjs.org/-/v1/search
- **What it provides**: Search across 2M+ npm packages with quality/popularity/maintenance scores. Find new CLI tools, developer utilities, and trending packages.
- **Access method**: REST JSON API, no auth required
- **Endpoint examples**:
  - `GET /-/v1/search?text=keywords:cli+tool&popularity=1.0&size=25` -- popular CLI tools
  - `GET /-/v1/search?text=keywords:devtools&quality=1.0&size=25` -- high-quality devtools
  - `GET /-/v1/search?text=keywords:developer+utility&size=25` -- dev utilities
- **Fields per package**: name, version, description, keywords[], downloads (weekly/monthly), dependents, publisher, score (final, detail.popularity, detail.quality, detail.maintenance), updated, links (homepage, repository, bugs, npm)
- **Rate limits**: Not strictly documented, generous for reads
- **Signal quality**: MEDIUM-HIGH -- popularity scores and download counts reveal real adoption; combined with npm download counts API (`api.npmjs.org/downloads/point/last-week/{package}`) for trend detection
- **Implementation**: EASY -- standard REST JSON
- **Recommended cadence**: Daily for keyword searches, weekly for trend analysis

---

### 5. HN Show HN (Algolia) -- Enhanced Filter

- **URL**: https://hn.algolia.com/api/v1/search
- **What it provides**: You already ingest HN, but the Algolia API supports `show_hn` tag filtering with numeric filters for points and comment counts. This surfaces developer tool LAUNCHES specifically.
- **Access method**: REST JSON API, no auth required
- **Endpoint examples**:
  - `/search?tags=show_hn&numericFilters=points>20&hitsPerPage=50` -- Show HN posts with 20+ points
  - `/search_by_date?tags=show_hn&numericFilters=created_at_i>{unix_ts}` -- recent Show HN sorted by date
- **Fields**: title, url, points, num_comments, author, created_at, story_text, objectID
- **Rate limits**: 10,000 req/hour
- **Signal quality**: VERY HIGH -- Show HN is specifically developer tool launches with community validation via upvotes. ~1.8M total Show HN posts in index.
- **Implementation**: EASY -- likely an enhancement to existing HN connector, add `tags=show_hn` filter
- **Recommended cadence**: Hourly

---

### 6. PyPI New Packages RSS Feed

- **URL**: https://pypi.org/rss/packages.xml (new packages), https://pypi.org/rss/updates.xml (new releases)
- **What it provides**: Stream of every new Python package published. 40 items per feed snapshot. Many are CLI tools, developer utilities, and automation scripts.
- **Access method**: RSS XML feed, no auth
- **Fields**: title (package name), link (PyPI URL), description, author email, pubDate
- **Rate limits**: None documented (standard RSS polling etiquette)
- **Signal quality**: MEDIUM -- high volume, need filtering to find dev-tool relevant packages. Many MCP servers and AI tools appearing (strong 2025-2026 trend signal).
- **Implementation**: EASY -- RSS parser, same pattern as existing RSS connectors
- **Recommended cadence**: Daily, filter for keywords in title/description (cli, tool, developer, devops, automation)

---

### 7. crates.io API (Rust Package Registry)

- **URL**: https://crates.io/api/v1/crates
- **What it provides**: All Rust crates with download counts, versions, and metadata. Rust ecosystem is heavily CLI/devtool oriented -- many modern unix replacements (ripgrep, fd, bat, exa) originated here.
- **Access method**: REST JSON API, no auth required (must set User-Agent per crawler policy)
- **Endpoint examples**:
  - `GET /api/v1/crates?page=1&per_page=25&sort=new` -- newest crates
  - `GET /api/v1/crates?page=1&per_page=25&sort=downloads` -- most downloaded
  - `GET /api/v1/crates?q=cli+tool&per_page=25` -- search for CLI tools
- **Fields**: name, description, downloads, recent_downloads, newest_version, repository, homepage, keywords, categories, created_at, updated_at
- **Rate limits**: 1 req/sec per crawler policy
- **Signal quality**: HIGH -- Rust ecosystem over-indexes on CLI tools and developer utilities. Recent downloads vs total downloads reveals trending crates.
- **Implementation**: EASY -- standard REST JSON with pagination
- **Recommended cadence**: Daily for new crates, weekly for trend analysis
- **Bonus**: lib.rs Atom feed at `https://lib.rs/atom.xml` provides 50 notable new crate releases with category tags

---

## TIER 2 -- HIGH SIGNAL, MEDIUM IMPLEMENTATION

These require slightly more work but provide unique signals not available elsewhere.

---

### 8. GitHub Trending Repos (Page Scrape)

- **URL**: https://github.com/trending
- **What it provides**: Daily/weekly/monthly trending repositories by language. Directly surfaces the hottest new developer tools being starred on GitHub.
- **Access method**: HTML scraping (no official API for trending)
- **Data available**: repo name/owner, description, language, total stars, stars gained today, built-by contributors
- **Variants**: `/trending?since=daily`, `/trending?since=weekly`, `/trending/typescript?since=daily` (filter by language)
- **Rate limits**: Standard GitHub web rate limits, be polite
- **Signal quality**: VERY HIGH -- direct measure of what developers are excited about RIGHT NOW
- **Implementation**: MEDIUM -- requires HTML parser, but structure is stable. Third-party APIs exist (github-trending-api) but self-scraping is more reliable.
- **Recommended cadence**: Daily
- **Note**: Complement with GitHub REST API (`/repos/{owner}/{repo}`) to get full metadata for trending repos

---

### 9. Mastodon Developer Instances (fosstodon.org, hachyderm.io)

- **URL**: https://fosstodon.org, https://hachyderm.io
- **What it provides**: Developer community posts from the fediverse's largest tech-focused instances. Verified working: unauthenticated hashtag timeline API returns posts about developer tools.
- **Access method**: Mastodon REST API, no auth required for public timelines
- **Endpoint examples**:
  - `GET /api/v1/timelines/tag/devtools?limit=40` -- posts tagged #devtools
  - `GET /api/v1/timelines/tag/cli?limit=40` -- posts tagged #cli
  - `GET /api/v1/timelines/tag/opensource?limit=40` -- open source posts
  - `GET /api/v1/timelines/tag/programming?limit=40` -- general programming
  - Supports `any[]`, `all[]`, `none[]` for combining/excluding tags
- **Fields**: content (HTML), created_at, account (acct, display_name), url, reblogs_count, favourites_count, replies_count, tags[]
- **Rate limits**: 300 req/5min per IP (Mastodon default)
- **Signal quality**: MEDIUM-HIGH -- real developer voices, authentic pain points, tool recommendations. Fosstodon is FOSS-focused (49k users), Hachyderm is tech-industry focused (1k+ users). Dev.to itself posts to Fosstodon.
- **Implementation**: MEDIUM -- need to poll multiple instances and hashtags, aggregate, deduplicate
- **Recommended cadence**: Twice daily (morning + evening)

---

### 10. Stack Exchange API (Stack Overflow Questions)

- **URL**: https://api.stackexchange.com/2.3/
- **What it provides**: Developer questions (pain points) filtered by tags. Unanswered high-vote questions are strong signals for unmet developer needs.
- **Access method**: REST JSON API, no auth required (compressed responses)
- **Endpoint examples**:
  - `GET /2.3/questions/no-answers?order=desc&sort=votes&tagged=command-line&site=stackoverflow` -- unanswered CLI questions by votes
  - `GET /2.3/questions?order=desc&sort=hot&tagged=developer-tools&site=stackoverflow` -- hot devtools questions
  - `GET /2.3/questions?order=desc&sort=activity&tagged=terminal&site=stackoverflow` -- recent terminal questions
- **Fields**: title, tags[], score, view_count, answer_count, is_answered, link, creation_date
- **Rate limits**: 300 requests/day unauthenticated, 10,000/day with API key (free registration)
- **Signal quality**: MEDIUM-HIGH for pain points -- high-vote unanswered questions directly map to unsolved developer problems. Hot questions show what developers are struggling with NOW.
- **Implementation**: MEDIUM -- need gzip decompression, smart tag selection, and filtering logic
- **Recommended cadence**: Daily, rotate through relevant tags (cli, command-line, terminal, developer-tools, devops, automation)

---

### 11. Hashnode GraphQL API

- **URL**: https://gql.hashnode.com/
- **What it provides**: Developer blog posts from Hashnode's network. Similar to Dev.to but different author base. GraphQL allows precise field selection.
- **Access method**: GraphQL POST endpoint, no auth required for reads
- **Query example**:
  ```graphql
  query {
    searchPostsOfPublication(first: 10, filter: { query: "CLI tool" }) {
      edges { node { title, brief, url, reactionCount, responseCount, publishedAt } }
    }
  }
  ```
- **Rate limits**: 20,000 requests/minute for queries (very generous)
- **Signal quality**: MEDIUM -- less engagement than Dev.to but different author pool, some unique content
- **Implementation**: MEDIUM -- GraphQL client needed instead of REST
- **Recommended cadence**: Daily

---

### 12. TrackAwesomeList RSS Feeds

- **URL**: https://www.trackawesomelist.com/
- **What it provides**: Tracks daily changes to 500+ awesome-lists on GitHub. When a new tool gets added to awesome-cli-apps, awesome-shell, or modern-unix, it appears here.
- **Access method**: Atom/RSS feeds per awesome-list
- **Feed URL**: `https://www.trackawesomelist.com/{owner}/{repo}/rss.xml`
- **Key feeds for dev tools**:
  - `/agarrharr/awesome-cli-apps/rss.xml` -- new CLI apps
  - `/alebcay/awesome-shell/rss.xml` -- new shell tools
  - `/ibraheemdev/modern-unix/rss.xml` -- modern unix replacements
  - `/johnalanwoods/maintained-modern-unix/rss.xml` -- maintained modern unix
  - `/Kikobeats/awesome-cli/rss.xml` -- CLI experiences
  - `/veggiemonk/awesome-docker/rss.xml` -- Docker tools
  - `/toolleeo/cli-apps/rss.xml` -- largest CLI list (CSV format)
- **Fields per entry**: title (date + summary), content (HTML with categorized project links, star counts, descriptions), updated, published
- **Rate limits**: None (static RSS)
- **Signal quality**: HIGH -- curated additions to authoritative lists represent community-vetted tools. A tool getting added to awesome-cli-apps is a strong signal.
- **Implementation**: MEDIUM -- Atom parser, multiple feeds to poll, HTML content parsing
- **Recommended cadence**: Daily

---

## TIER 3 -- UNIQUE SIGNAL, HARDER IMPLEMENTATION

These provide differentiated signals but require more engineering effort.

---

### 13. Bluesky Jetstream (AT Protocol Firehose)

- **URL**: wss://jetstream2.us-east.bsky.network/subscribe
- **What it provides**: Real-time stream of ALL public Bluesky posts. Filter for developer tool discussions. Growing developer community migrated from Twitter.
- **Access method**: WebSocket (unauthenticated), JSON events
- **Connection**: `wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post`
- **Filtering**: Post-connection, filter by keywords/hashtags in post text. ~850 MB/day for all posts.
- **Rate limits**: No rate limit on firehose consumption. 4 official public instances.
- **Signal quality**: MEDIUM -- growing developer community, real-time pulse of what developers discuss. Note: Bluesky's search API requires authentication, but Jetstream firehose does NOT.
- **Implementation**: HARD -- WebSocket consumer, keyword extraction, hashtag filtering, volume management
- **Recommended cadence**: Continuous (batch every 30min-1hr)
- **Key hashtags**: #devtools, #cli, #programming, #opensource, #webdev, #rust, #typescript

---

### 14. VS Code Marketplace API

- **URL**: https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery/
- **What it provides**: Metadata for 60,000+ VS Code extensions including download counts and ratings. Rising extensions reveal developer workflow gaps being filled.
- **Access method**: POST JSON API, no auth required
- **Request format**: POST with `Content-Type: application/json`, `Accept: application/json;api-version=3.0-preview.1`
- **Filter types**: Tag (1), Extension ID (4), Extension Name (7), Target Platform (8), Full-Text Search (10)
- **Query flags**: IncludeStatistics (256), IncludeLatestVersionOnly (512)
- **Fields**: extension name, publisher, description, install count, average rating, categories, tags
- **Rate limits**: Not documented, be polite
- **Signal quality**: HIGH -- extensions directly map to developer workflow gaps. Rising install counts on new extensions signal unmet needs.
- **Implementation**: HARD -- unusual POST-based API with numeric filter types and flag bitfields
- **Recommended cadence**: Weekly, snapshot popular extensions and detect risers

---

### 15. Docker Hub Search API

- **URL**: https://hub.docker.com/v2/search/repositories/
- **What it provides**: Container images with pull counts and star counts. Developer tool containers reveal tools gaining adoption in DevOps workflows.
- **Access method**: REST JSON API, no auth required for search
- **Endpoint examples**:
  - `GET /v2/search/repositories/?query=developer+tools&page_size=25` -- search dev tools
  - `GET /v2/repositories/library/?page_size=25&ordering=-pull_count` -- official images by pulls
- **Fields**: repo_name, short_description, star_count, pull_count, is_official, is_automated
- **Rate limits**: Abuse-level rate limiting (thousands of requests/min OK)
- **Signal quality**: MEDIUM -- pull counts show adoption but noisy (CI/CD inflates counts). Best for detecting new developer tool containers.
- **Implementation**: MEDIUM -- standard REST, but need smart filtering to find dev-relevant images
- **Recommended cadence**: Weekly

---

### 16. GitHub Discussions GraphQL API

- **URL**: https://api.github.com/graphql
- **What it provides**: Feature requests, bug reports, and "what tools do you use" discussions in developer-facing repositories. Repository-level discussions only.
- **Access method**: GraphQL API, requires GitHub token (free)
- **Signal quality**: MEDIUM-HIGH -- feature requests in popular repos reveal tool gaps. Pain points discussed at length.
- **Implementation**: HARD -- need to identify and poll relevant repos, GraphQL queries, token management
- **Recommended cadence**: Daily, target high-traffic repos (vercel/next.js, denoland/deno, etc.)

---

### 17. Discourse Forums (freeCodeCamp, Discourse Meta)

- **URL**: https://forum.freecodecamp.org/, various Discourse instances
- **What it provides**: Developer help topics from Discourse-powered forums. FCC has 30 topics per page, includes views, reply counts, and category IDs.
- **Access method**: Append `.json` to any Discourse URL (e.g., `/latest.json`)
- **Fields**: id, title, posts_count, reply_count, views, like_count, category_id, created_at, has_accepted_answer
- **Rate limits**: Default Discourse rate limits apply per-instance
- **Signal quality**: MEDIUM -- beginner-focused (freeCodeCamp), but high-view unanswered topics reveal tooling gaps
- **Implementation**: MEDIUM -- need to identify relevant Discourse instances, filter by category
- **Recommended cadence**: Daily

---

## TIER 4 -- SUPPLEMENTARY / PERIODIC

These are useful for periodic enrichment but not primary ingestion.

---

### 18. npm Download Counts API

- **URL**: https://api.npmjs.org/downloads/
- **What it provides**: Daily/weekly/monthly download counts for any npm package. Use to validate whether a detected tool signal has real adoption.
- **Endpoint**: `GET /downloads/point/last-week/{package}` or bulk `{pkg1},{pkg2},{pkg3}`
- **Signal quality**: HIGH for validation (not discovery)
- **Implementation**: EASY
- **Use case**: Enrich existing signals with download trend data

---

### 19. Changelog News RSS Feed

- **URL**: https://changelog.com/news/feed
- **What it provides**: Weekly curated developer news podcast with chapter markers linking to specific tools and projects. High editorial quality.
- **Fields**: title, description, pubDate, chapters with URLs, transcript link
- **Signal quality**: HIGH for editorial curation, LOW volume (weekly)
- **Implementation**: EASY -- RSS parser
- **Recommended cadence**: Weekly

---

### 20. Stack Overflow Annual Developer Survey

- **URL**: https://survey.stackoverflow.co/2025/
- **What it provides**: Annual survey data on most loved/dreaded/wanted tools, languages, and technologies. Raw data available for download.
- **Signal quality**: VERY HIGH for macro trends, but annual cadence limits real-time utility
- **Implementation**: EASY (annual download and parse)
- **Recommended cadence**: Annual

---

## EXCLUDED SOURCES

| Source | Reason for Exclusion |
|--------|---------------------|
| AlternativeTo.com | No public API, would require scraping, ToS unclear |
| StackShare API | Paid API ("Clearbit for tech stacks"), not free |
| Twitter/X | Requires paid API ($100+/month minimum), already have twitter_byo connector |
| Bluesky Search API | Requires authentication (403 for unauthenticated), use Jetstream instead |
| State of JS/CSS surveys | Annual only, data not machine-readable in real-time |
| GitHub Explore | No API for curated collections, would need to scrape |

---

## IMPLEMENTATION PRIORITY MATRIX

Based on signal quality, implementation effort, and uniqueness:

### Phase 1 (Week 1) -- Quick Wins
| # | Source | Effort | Signal | Notes |
|---|--------|--------|--------|-------|
| 1 | Dev.to API | 1 day | HIGH | REST JSON, tag filtering, engagement metrics |
| 2 | Lobsters JSON | 0.5 day | HIGH | Simplest API of all, append .json |
| 3 | HN Show HN filter | 0.5 day | VERY HIGH | Enhancement to existing HN connector |
| 5 | Homebrew Analytics | 0.5 day | VERY HIGH | Static JSON, actual adoption data |

### Phase 2 (Week 2) -- Package Registries
| # | Source | Effort | Signal | Notes |
|---|--------|--------|--------|-------|
| 4 | npm Registry Search | 1 day | HIGH | Package discovery + download counts |
| 6 | PyPI RSS | 0.5 day | MEDIUM | RSS feed, keyword filtering |
| 7 | crates.io API | 1 day | HIGH | Rust ecosystem = CLI tool goldmine |

### Phase 3 (Week 3) -- Community Signals
| # | Source | Effort | Signal | Notes |
|---|--------|--------|--------|-------|
| 8 | GitHub Trending | 1.5 days | VERY HIGH | HTML scraper, language filtering |
| 9 | Mastodon (fosstodon) | 1 day | MEDIUM-HIGH | Multiple instances, hashtag polling |
| 10 | Stack Overflow API | 1 day | MEDIUM-HIGH | Pain point detection, tag rotation |
| 12 | TrackAwesomeList | 1 day | HIGH | Multiple RSS feeds, HTML parsing |

### Phase 4 (Week 4+) -- Advanced
| # | Source | Effort | Signal | Notes |
|---|--------|--------|--------|-------|
| 11 | Hashnode GraphQL | 1 day | MEDIUM | GraphQL client needed |
| 13 | Bluesky Jetstream | 2 days | MEDIUM | WebSocket consumer, keyword filter |
| 14 | VS Code Marketplace | 1.5 days | HIGH | Unusual POST API, bitfield flags |

---

## SIGNAL CORRELATION STRATEGY

The real power comes from correlating signals across sources:

1. **Tool appears on GitHub Trending** + **mentioned in Show HN** + **Homebrew installs rising** = Strong validated opportunity signal
2. **High-vote unanswered SO question** + **Dev.to article about workaround** + **no npm package for it** = Unmet need signal
3. **New crate on crates.io** + **added to awesome-cli-apps** + **discussed on Lobsters** = Emerging tool signal
4. **Mastodon #devtools buzz** + **Dev.to article** + **new PyPI package** = Multi-platform launch signal

---

## ESTIMATED TOTAL NEW CONNECTORS

- Phase 1: 4 connectors (3 days)
- Phase 2: 3 connectors (2.5 days)
- Phase 3: 4 connectors (4.5 days)
- Phase 4: 3 connectors (4.5 days)

**Total**: 14 new connectors, ~14.5 dev days, bringing the platform from 9 to 23 data sources.
