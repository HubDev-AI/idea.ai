# Idea-Signal Connectors — Phased Plan

**Status:** paused 2026-04-27 (resume later).
**Goal:** broaden idea.ai's signal intake with free, reliable, primary sources that surface *unmet demand* — not catalogs.

## Live verification (2026-04-27)

21 candidate endpoints probed via direct fetch. 14 returned 200 unauthenticated, sub-2s latency.

## Filter for idea-generation value

Catalogs (crates.io, HuggingFace, Flathub, F-Droid, Codeberg, GitLab projects, arXiv, OpenAlex, pypistats) describe **what exists**. They are useful for *validating* an idea (trend deltas, competition mapping) — not for *originating* one. They are dropped from this plan and reserved for a separate "ecosystem-trend" connector class.

What survives: sources that surface explicit pain, explicit demand, or explicit budget attached to an unmet need.

## Eight connectors to ship

### Phase 1 — no-auth (5)

| # | Connector | Endpoint | Signal shape |
|---|---|---|---|
| 1 | **StackExchange** (reference) | `api.stackexchange.com/2.3/questions?site={site}` across serverfault, superuser, dba, unix, webmasters, askubuntu, datascience | Questions = developer/ops pain. Tags + score + view-count = severity proxy. |
| 2 | **HN Algolia (Ask HN)** | `hn.algolia.com/api/v1/search?tags=ask_hn` | Direct "I need X" posts. Highest idea-density per item. |
| 3 | **RemoteOK** | `remoteok.com/api` | Job posts = paid pain. Stack + JD reveals what orgs are willing to spend on. |
| 4 | **WeWorkRemotely** | `weworkremotely.com/categories/remote-programming-jobs.rss` | Same as RemoteOK, RSS-shaped, broader pool. |
| 5 | **NVD CVE** | `services.nvd.nist.gov/rest/json/cves/2.0` | New CVEs = security-tooling demand. CVSS = severity weight. |

### Phase 2 — `_byo` user-supplied key (3)

| # | Connector | Endpoint | Auth |
|---|---|---|---|
| 6 | **GitHub Discussions** | `api.github.com` GraphQL | PAT — same auth pattern as existing GitHub Issues connector. Feature-asks > bug-issues for idea-signal. |
| 7 | **SAM.gov Opportunities** | `api.sam.gov/opportunities/v2/search` | Free key, registration. B2B gold: explicit unmet need + explicit budget. |
| 8 | **Slant.co** | HTML scrape of `slant.co` | None, but rate-limit-sensitive. "Best tool for X" rankings = unsolved-category map. |

## Branching strategy (decided 2026-04-27)

1. Scaffold StackExchange first as the reference connector. One PR. Establish shared types + registry shape needed by the other four.
2. After scaffold merges to `dev`, spawn 4 parallel worktree-isolated agents — one each for HN-Algolia, RemoteOK, WWR, NVD. 4 PRs against `dev`.
3. Once Phase 1 lands, repeat with 3 parallel agents for Phase 2 `_byo` connectors.

Each connector mirrors the existing `packages/connectors/src/dataforseo_serp_byo.ts` shape: fetch → normalize → emit signals. UI label in `apps/web/src/connectorNames.ts`. Ingest job under `apps/api/src/jobs/`.

## Endpoint quirks discovered during probe

- **GitHub Discussions** anonymous = 403. Auth fixes; reuse existing GH token wiring.
- **pypistats.org** = 429-aggressive. Use `pypi.org/pypi/{pkg}/json` instead if PyPI signal is wanted later.
- **F-Droid** `/api/v1/packages/` = 403. Real catalog at `f-droid.org/repo/index-v2.json`. (Out of scope for the 8 — listed only because it appeared in the probe.)
- **TED_EU** = POST-only with JSON query body. Workable when added.
- **Polymarket** `gamma-api` host refused connection. Try `clob.polymarket.com` or `data-api.polymarket.com` next pass.
- **OpenReview** needs `id` / `invitation` / `forum` param.
- **SAM.gov v2 search** = 404 anonymous, requires registered key.

## Rejected for idea-generation value (catalogs only)

crates.io, Hugging Face Hub, Flathub, F-Droid, Codeberg search, GitLab projects, OpenAlex, arXiv, pypistats, Manifold, Polymarket. Strong as *trend* / *validation* signals; weak as *origination* signals. Keep these out of the connector roster until we add a separate `ecosystem-trend` feature.
