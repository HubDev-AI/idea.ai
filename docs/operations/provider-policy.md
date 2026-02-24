# Provider Policy

## Runtime Provider Order

1. Primary: `claude -p`
2. Fallback: `codex exec --json -o <output-file>`

## Selection Rules

- Use Claude first for scoring and recommendation prompts.
- Fallback to Codex on timeout or non-zero Claude exit.
- Record provider and outcome metadata for each run.

## Operational Limits

- Prompt timeout must be explicitly set (`timeoutMs`).
- Non-zero exits are considered hard failures for the current provider.
- Never run both providers in parallel for the same prompt in v1.
