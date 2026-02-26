# Idea Engine V2 Redesign

> Date: 2026-02-25
> Status: Approved
> Approach: Hybrid A+B — rebuild intelligence layer + add autonomous research agent

## Problem Statement

The current system (V1) works end-to-end but the intelligence is mostly fake:
- Pain/timing scoring is keyword counting, not semantic understanding
- Embeddings are 32-dim hash vectors with near-random retrieval quality
- Buildability always returns ~63 when AI is unavailable (hardcoded fallback)
- Thesis synthesis exists in code but is orphaned (not called, no persistence, no API routes)
- No cross-source deduplication
- No feedback or learning loop
- UI is a single flat view with no thesis visibility

## Vision

Three-layer system, all three running concurrently:

1. **Signal Dashboard** — real-time radar of scored signals from diverse sources
2. **Idea Generator** — AI-scored, cross-source clustered opportunities with evidence
3. **Autonomous Researcher** — long-running agent that synthesizes theses over weeks/months

## Architecture

Two processing layers on shared infrastructure:

### Layer 1: Pipeline (upgraded V1)

Handles structured, repeatable work:

```
Connectors → Ingest → Noise Gate (AI Tier 1) → Score (AI Tier 2) → Memory Index → Rank → Publish
```

- Keep: BullMQ queues, Postgres + pgvector, Fastify API, Docker, connector interface pattern
- Replace: keyword scoring → tiered AI scoring via CLI
- Replace: hash embeddings → Ollama semantic embeddings
- Add: cross-source dedup via embedding similarity
- Add: noise gate as first AI pass

### Layer 2: Research Agent (new)

A Claude-driven autonomous agent running on a schedule:

```
Postgres + pgvector (shared memory)
       ↕
Research Agent (claude -p + codex exec with tools)
       ↓
Thesis updates, new candidates, alerts
```

- Runs daily (configurable)
- Loads context: active theses, new signals since last run, trend windows
- Dual-analyst: same prompt sent to both Claude and Codex independently
- Reconciliation: agreements = high confidence, disagreements = flagged for investigation
- Can request follow-up research (web search, targeted connector re-query)
- All state in Postgres — agent is stateless between runs

### How They Connect

- Pipeline feeds the agent's memory (scored signals, embeddings, trend windows → shared Postgres)
- Agent reads from that memory and adds its own research observations
- Theses come from the Agent, informed by Pipeline data
- UI shows both: real-time signals (Pipeline) and long-horizon theses (Agent)

## Tiered AI Scoring

All AI via local CLI (`claude -p` primary, `codex exec` fallback). No API keys.

### Tier 1: Noise Gate (cheap, batch)

- Runs on every ingested raw signal
- One CLI call per batch of 10-20 signals
- Prompt: classify each as `noise | weak | strong`
- Kills ~60-80% of signals before real scoring
- Both providers classify independently for quality

### Tier 2: Signal Scoring (medium, per-signal)

- Runs on `weak` and `strong` signals only
- One CLI call per signal (or batch of 3-5)
- Structured output: `{ pain, timing, buildability, reasoning }`
- Dual-analyst: both Claude and Codex score independently, median used
- No hardcoded fallbacks — if AI unavailable, mark as "unscored"

### Tier 3: Thesis Synthesis (deep, daily)

- The Research Agent described above
- Both providers reason about thesis evolution independently
- Reconciliation produces final confidence updates
- Output: thesis updates, new candidates, alerts

### Estimated daily CLI usage

- Tier 1: ~5-10 batch calls
- Tier 2: ~5-20 calls (strong/weak signals only)
- Tier 3: ~2-4 calls (one per provider + follow-ups)
- Total: ~12-34 CLI calls/day

## Memory & Embeddings

### Embedding Engine

- Ollama running `nomic-embed-text` (768-dim semantic vectors)
- Every signal's canonical text gets a real embedding on ingest
- Stored in `signal_embeddings` via pgvector (table already exists)

### Retrieval Modes

- **Local retrieval** (for scoring): find signals similar to THIS signal
- **Global retrieval** (for synthesis): find all signals related to THIS thesis
- **Hybrid search**: pgvector cosine similarity + PostgreSQL tsvector full-text search, merged by reciprocal rank fusion (RRF)

### Trend Windows

- Keep 7d/30d/90d aggregation
- Momentum = 7d vs 30d growth rate → fed into agent context
- Used for thesis confidence scoring

### Cross-Source Dedup

- New signal embedding >0.92 similarity to existing signal from different source → merge
- Creates multi-source evidence clusters
- Agent sees "3 independent sources mention same problem" as high-confidence

## Data Sources

### Community Pain (keep + expand)

- **HN** (keep, hourly) — developer pain
- **GitHub Issues** (keep, hourly) — open-source pain points
- **Reddit** (new, hourly) — r/SaaS, r/startups, r/smallbusiness, r/Entrepreneur + configurable subreddits via public JSON API
- **Indie Hackers** (new, daily) — founder pain (HTML scraping)

### Market Signals (new)

- **Product Hunt** (new, daily) — new launches via GraphQL API
- **YC Companies** (keep, daily) — what YC is betting on (Algolia index)

### Money Signals (rethink existing)

- **Crunchbase** (new, BYO) — funding rounds, API key required
- **Greenhouse/Lever** (demoted to optional) — job postings as corroboration signals, not primary

### Regulatory/Trend Signals (keep BYO)

- **Perigon** (keep, BYO) — news API for regulatory changes
- **Exa** (keep, BYO) — semantic web search for trends

### Future: Browser Agent Connectors

Architecture should support a third connector type for future:
- API connectors (HN, Reddit, PH)
- BYO API connectors (Exa, Perigon, Crunchbase)
- Browser agent connectors (Twitter/X via logged-in session, G2 reviews, LinkedIn)

## Thesis Lifecycle

```
Signals → Cluster → Candidate → Watching → Promoted → [ALERT] → Acted / Stale / Rejected
```

### States

1. **Candidate**: Agent groups related signals. Minimum: 2+ signals from 2+ sources.
2. **Watching**: Evidence accumulates. Confidence built from:
   - Pain persistence (35%) — recurring pain across windows
   - Momentum (25%) — signal growth rate
   - Novelty/whitespace (15%) — low competition
   - Multi-source corroboration (15%) — independent source confirmation
   - Buildability (10%) — feasibility from dual-analyst scoring
3. **Promoted** (≥80% confidence, ≥3 sources, ≥3 weeks observation): triggers alert
4. **Stale**: No reinforcing evidence for 2+ weeks → -5% confidence/week → stale at 40%
5. **Rejected**: Strong contradictory evidence → agent marks with reasoning

### Alerting

- Write to `thesis_alerts` table on promotion
- UI notification badge
- Future: email/push notification

### Dual-Analyst Reconciliation

- Both agree → apply directly
- One sees something other doesn't → flag for investigation
- Disagree → mark thesis as "contested", run follow-up probe

## UI: Single-Page Dashboard

All information on one scrollable page, no tab navigation.

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  HEADER: Stats bar                                       │
│  (signals today, connectors, agent last run, top thesis) │
├──────────────────────────────────────────────────────────┤
│  TOP THESES (horizontal cards, 2-3 promoted/watching)    │
│  Each: title, confidence %, evidence count, sources,     │
│        status badge. Expandable for evidence trail.      │
├──────────────┬───────────────────────────────────────────┤
│  AGENT       │  SIGNAL FEED (scrollable)                 │
│  ACTIVITY    │  Expandable cards with score breakdown:   │
│  (sidebar)   │  pain/timing/buildability + AI reasoning  │
│              │  Cross-source clusters grouped visually    │
│  Last run,   │  Filter/sort by source, score, recency    │
│  thesis      │                                           │
│  updates,    │  CONNECTOR HEALTH (compact inline row)    │
│  disagreed,  │  Status dots per connector                │
│  next target │                                           │
├──────────────┴───────────────────────────────────────────┤
│  LOGS (collapsed, expandable drawer at bottom)           │
└──────────────────────────────────────────────────────────┘
```

### Key UI changes from V1

- Theses at top — most valuable output, immediately visible
- Agent activity as left sidebar — compact summary of AI researcher state
- Signal cards expandable with score breakdown and AI reasoning
- Connector health as compact dot row, not full card
- Logs collapsed by default, expandable drawer (reclaims 440px)
- Cross-source clusters visually grouped

## What Changes From Current Codebase

### Replace

- Keyword scoring → tiered AI scoring (Tier 1-3)
- Hash embeddings → Ollama `nomic-embed-text` (768-dim)
- Hardcoded buildability fallback → "unscored" state when AI unavailable

### Wire In

- Thesis synthesizer → full agent loop with DB persistence
- Thesis API routes (already partially built)

### Add

- Reddit, ProductHunt connectors
- Cross-source dedup via embedding similarity
- Noise gate (Tier 1 batch AI)
- Dual-analyst pattern (Claude + Codex independent reasoning)
- Thesis lifecycle with confidence-based alerting
- Thesis board section in UI
- Agent activity sidebar in UI

### Keep

- BullMQ queue topology
- Postgres + pgvector (add thesis tables)
- Fastify API framework
- React + Vite frontend framework
- Docker setup
- Connector interface pattern
- Scheduler cron pattern
- Worker routing

## Constraints

- No API keys — all AI via `claude -p` and `codex exec` CLI
- Ollama required for embeddings (local, free)
- Event-driven only — user interacts only when system surfaces high-confidence theses
- Outcome metric: one actionable SaaS idea per week

## Success Criteria

1. Signal scoring uses real AI (not keyword heuristics)
2. Embeddings are semantic (Ollama 768-dim, not hash 32-dim)
3. Retrieval returns meaningfully similar historical signals
4. Thesis lifecycle works: signals accumulate → confidence builds → promotion → alert
5. Dual-analyst disagreements surface contested theses
6. Cross-source dedup merges same-problem signals from different sources
7. Dashboard shows theses, agent activity, and expandable signal detail on one page
8. System runs unattended; alerts only on high-confidence theses
