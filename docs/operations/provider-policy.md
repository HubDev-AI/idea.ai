# Provider Policy

## Runtime Provider Order

1. Primary: `claude -p` (headless pipe mode, no skill/agent overhead)
2. Fallback: `codex exec --json` (available when `AI_PROVIDER_FALLBACK=true`)

## Why claude is the default

`codex exec` is an interactive agent that loads ~60 skill directories from `~/.codex/skills/` on every invocation. This injects 17–67K tokens of overhead and causes the agent to read additional skill files during processing. For headless text analysis (post-scrape scoring, thesis synthesis), this overhead causes consistent timeouts at the 180s threshold.

`claude -p` runs in pipe mode with zero skill overhead, completing the same analysis in seconds.

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `AI_PROVIDER` | `claude` | Primary provider (`claude` or `codex`) |
| `AI_PROVIDER_FALLBACK` | `true` | Try the other provider if primary fails |
| `AI_PROVIDER_RETRIES` | `1` | Retry attempts per provider before moving to fallback |

## Circuit Breaker

The circuit breaker automatically routes around consistently-failing providers:

- After `CIRCUIT_BREAKER_THRESHOLD` (default 3) consecutive failures, the provider circuit opens.
- Open circuits skip the failing provider entirely for `CIRCUIT_BREAKER_COOLDOWN_MS` (default 10 min).
- After cooldown, a single probe request tests if the provider has recovered.

## Adversarial Debate

The debate feature runs both Claude and Codex in parallel (bull/bear/moderator pattern) to stress-test high-confidence theses.

| Env Var | Default | Description |
|---------|---------|-------------|
| `DEBATE_ENABLED` | `true` | Master switch for adversarial debate |
| `DEBATE_CONFIDENCE_THRESHOLD` | `40` | Min thesis confidence to trigger debate |
| `DEBATE_MAX_PER_RUN` | `5` | Max theses debated per agent run |

Debate requires **both** `DEBATE_ENABLED=true` and `AI_PROVIDER_FALLBACK=true` (needs both providers). Set `DEBATE_ENABLED=false` to use fallback for reliability without paying for debate tokens.

## Selection Rules

- Use the primary provider for all scoring and analysis prompts.
- Fall back to the other provider on timeout or non-zero exit (when fallback is enabled).
- Record provider and outcome metadata for each run in execution logs.
- Circuit breaker state is visible via `GET /v1/ai-health`.
