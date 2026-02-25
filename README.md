# Idea AI

Sixth Sense SaaS idea engine for solo founders.

The app ingests signals from multiple sources, runs AI post-scrape opportunity synthesis, scores opportunities with memory-aware logic, and publishes a ranked feed with suggested next actions.

## Setup

Use [setup.md](./setup.md) as the source of truth for:
- local environment setup
- connector account configuration
- running API and web app
- verification and preview commands

Use [Sixth Sense V2 Roadmap](./docs/plans/2026-02-25-sixth-sense-v2-roadmap.md) for the next implementation phases.

## Repository Layout

- `apps/api` - Fastify API, ingestion/scoring jobs, runtime read model
- `apps/web` - React/Vite frontend
- `packages/connectors` - source connectors (open + BYO)
- `packages/pipeline` - ranking/scoring/routing pipeline logic
- `packages/contracts` - shared schemas/contracts
- `packages/ai-runtime` - local CLI AI provider adapters
- `docs/operations` - operational notes and provider policy

## Quick Commands

```bash
pnpm install
CI=1 pnpm test
pnpm lint
pnpm --filter @idea/api dev
pnpm --filter @idea/web dev
pnpm preview:pipeline
pnpm api:docker:up
```
