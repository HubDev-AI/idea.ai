# Idea AI

Sixth Sense SaaS idea engine for solo founders.

Ingests signals from multiple sources, runs AI opportunity synthesis, scores with memory-aware logic, and publishes a ranked feed with suggested next actions.

## Quick Start

**Prerequisites:** Docker, Node.js 20+, [pnpm](https://pnpm.io/)

```bash
make setup        # copy .env.example, install deps, start infra, run migrations
make dev          # start API (port 3000) + web UI (port 5173)
```

Open http://localhost:5173.

## Make Targets

| Target | Description |
|--------|-------------|
| `make setup` | First-time setup (env + install + infra + migrations) |
| `make install` | Install dependencies |
| `make infra` | Start Postgres, Redis, Ollama (Docker) |
| `make infra-down` | Stop infrastructure containers |
| `make db-migrate` | Run database migrations |
| `make dev` | Start API + web in parallel |
| `make dev-api` | Start API only |
| `make dev-web` | Start web UI only |
| `make docker-api` | Start API in Docker (with `claude -p` support) |
| `make docker-api-down` | Stop Docker API |
| `make docker-api-logs` | Tail Docker API logs |
| `make test` | Run all tests |
| `make lint` | Run linter |
| `make preview` | One-shot ingestion + scoring preview |
| `make health` | Check API health |
| `make stop` | Stop all services |

## Configuration

Copy `.env.example` to `.env` and edit. See [setup.md](./setup.md) for connector accounts, AI provider modes, and BYO API keys.

## Repository Layout

- `apps/api` - Fastify API, ingestion/scoring jobs, runtime read model
- `apps/web` - React/Vite frontend
- `packages/connectors` - source connectors (open + BYO)
- `packages/pipeline` - ranking/scoring/routing pipeline logic
- `packages/contracts` - shared schemas/contracts
- `packages/ai-runtime` - local CLI AI provider adapters
