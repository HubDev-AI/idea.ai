# Runbook

## Scheduling

- Hourly connectors: `HOURLY_CONNECTORS` (default `hn,github_issues`) on cron `0 * * * *`.
- Daily connectors: `DAILY_CONNECTORS` (default `greenhouse,lever,exa_byo,perigon_byo`) on cron `0 0 * * *`.
- BYO connectors are skipped unless API credentials are set.

## Reliability Guardrails

- Connector timeout: 15s.
- Retry attempts: 2 with backoff.
- Raw payload retention: 30 days.

## Cost Guardrails

- Enforce `EXA_DAILY_BUDGET_USD` and `PERIGON_DAILY_BUDGET_USD`.
- Set budget to `0` to hard-disable paid BYO connector execution.

## Disable Switches

- Remove connector names from `HOURLY_CONNECTORS` / `DAILY_CONNECTORS`.
- Unset `EXA_API_KEY` / `PERIGON_API_KEY` to disable BYO connectors.
