---
date: 2026-02-24
topic: sixth-sense-saas-idea-engine
---

# Sixth Sense SaaS Idea Engine

## What We're Building
An automated opportunity-intelligence app for solo founders. It continuously ingests multi-source signals from open connectors plus optional BYO-account connectors, normalizes them into a common schema, and produces a ranked feed of decision-ready one-line SaaS opportunities.

Each signal contains: idea statement, blended score, strongest source, supporting snippet, and a suggested next action. The product's "sixth sense" comes from combining weak-signal trend acceleration, hidden pain intensity, and buildability estimation.

## Why This Approach
Approaches considered:
- Central pipeline: fast to bootstrap, but scaling and failure isolation become harder as connector count grows.
- Source-agent architecture: strong source-level flexibility, but higher orchestration overhead early.
- Event-driven queue architecture (chosen): best balance for mixed cadences, reliability, and connector growth.

Chosen because it supports hourly and daily schedules cleanly, isolates connector failures via queues/retries, and allows independent scaling of ingestion, scoring, and ranking workers.

## Key Decisions
- Target user: solo founders.
- Source strategy: open connectors + optional BYO-account connectors in v1.
- V1 connector launch set: Hacker News, GitHub Issues, Greenhouse, Lever, Exa (BYO), Perigon (BYO).
- Output: decision-ready one-line signals.
- Ranking formula: pain 40% + timing 40% + buildability 20%.
- Buildability scoring: LLM-judged from evidence with 3 independent judges, median score.
- Refresh cadence: hybrid (hourly for high-velocity sources, daily for slower sources).
- Suggested action mode: adaptive recommendation (demand vs pricing vs channel validation).
- Core architecture: event-driven queue.
- 30-day success metric: at least 1 detected idea reaches paid pilot or preorder stage.
- AI invocation model: no API keys in v1; invoke local logged-in CLIs via adapters (`claude -p` and `codex exec`) to reuse existing subscriptions.
- AI provider routing: `claude -p` primary, `codex exec` fallback.

## Open Questions
- Per-connector rate-limit and budget policy for BYO services.
- Secret management and auth UX for BYO accounts.
- Provider terms/compliance policy for CLI-driven automation.
- Threshold definitions for high-velocity vs slow sources.
- Data retention policy for raw snippets and scored signals.

## Next Steps
→ `/workflows:plan` for implementation design: queue topology, schema contracts, scoring service boundaries, and phased connector rollout.
