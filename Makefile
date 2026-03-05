.PHONY: install env infra infra-down db-migrate dev dev-api dev-web test lint preview \
       docker-api docker-api-down docker-api-logs docker-api-shell stop

# --- Setup ---

install:
	pnpm install

env:
	cp -n .env.example .env || true

setup: env install infra db-migrate ## First-time setup

# --- Infrastructure ---

infra:
	docker compose -f docker-compose.infra.yml up -d

infra-down:
	docker compose -f docker-compose.infra.yml down

db-migrate:
	pnpm db:migrate

# --- Development ---

dev-api:
	pnpm --filter @idea/api dev

dev-web:
	pnpm --filter @idea/web dev

dev: ## Start API and web in parallel (use Ctrl+C to stop both)
	@trap 'kill 0' EXIT; \
	$(MAKE) dev-api & \
	$(MAKE) dev-web & \
	wait

# --- Docker API ---

docker-api:
	pnpm api:docker:up

docker-api-down:
	pnpm api:docker:down

docker-api-logs:
	pnpm api:docker:logs

docker-api-shell:
	pnpm api:docker:shell

# --- Quality ---

test:
	CI=1 pnpm test

lint:
	pnpm lint

# --- Tools ---

preview:
	pnpm preview:pipeline

# --- Lifecycle ---

stop: infra-down docker-api-down ## Stop all services

health:
	@curl -sf http://127.0.0.1:3000/health | jq . || echo "API not running"
