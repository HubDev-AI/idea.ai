# Agent Profiles: B2B/Enterprise Idea Generation

**Date**: 2026-03-06
**Status**: Approved

## Problem

The system has a structural consumer/social bias at three levels:
1. **Prompts**: Agent told to "STRONGLY PREFER consumer/social product ideas"
2. **Scoring**: Virality (35%) is the dominant weight, inherently favoring consumer products
3. **Sources**: ~10 of 18 connectors are consumer-trend focused; enterprise signals limited to job postings

Result: high-quality consumer ideas but insufficient B2B/enterprise idea output.

## Solution: Configurable Agent Profiles

A profile-driven system where agent behavior (prompts, scoring model, signal preferences, UI display) is defined by config objects. Ships with two built-in profiles: `consumer` and `b2b`. Future profiles can be added without code changes.

## Profile Schema

```typescript
interface AgentProfile {
  id: string;
  name: string;
  enabled: boolean;

  prompts: {
    identity: string;
    focusAreas: string[];
    antiPatterns: string[];
    exampleGood: string[];
    exampleBad: string[];
    scopeConstraint?: string;
  };

  scoring: {
    dimensions: {
      name: string;
      weight: number;       // 0-1, must sum to 1
      description: string;  // AI scoring prompt
    }[];
  };

  signals: {
    connectorWeights?: Record<string, number>;
    additionalSubreddits?: string[];
    signalFilter?: string;
  };

  display: {
    badge: string;
    badgeColor: string;
    icon?: string;
    defaultSort?: string;
  };
}
```

## Built-in Profiles

### Consumer Profile (existing behavior, extracted into config)

- **Identity**: "You specialize in finding CONSUMER and SOCIAL product ideas with viral growth potential."
- **Scoring**: demand (25%), timing (20%), buildability (20%), virality (35%)
- **Display**: Badge "Consumer", blue color

### B2B Profile (new)

- **Identity**: "You specialize in finding B2B and ENTERPRISE SaaS product ideas with strong revenue potential, defensible moats, and clear buyer personas."
- **Focus areas**: vertical SaaS, API products, workflow automation, compliance tools, developer infrastructure, data platforms, enterprise integrations
- **Anti-patterns**: "Do NOT suggest consumer social apps, viral mobile games, or creator tools"
- **Scope**: Flexible (solo founder to small team), no artificial constraint on build time

**B2B Scoring Model** (4 dimensions):

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Enterprise Pain | 30% | Severity and frequency of the problem in business contexts. Are teams losing money, time, or compliance? |
| Market Size | 25% | Total addressable market and willingness to pay. Enterprise budgets, contract values. |
| Moat Potential | 25% | Defensibility once built: data network effects, integration lock-in, regulatory moats, switching costs. |
| Feasibility | 20% | Can a small team build a credible v1? API availability, regulatory complexity, integration requirements. |

**Display**: Badge "B2B", green color

## New B2B Signal Sources

| Source | Type | Cadence | Signal Value |
|--------|------|---------|-------------|
| Enterprise subreddits | Reddit (existing infra) | Daily | r/devops, r/sysadmin, r/ITManagers, r/msp, r/salesforce, r/aws |
| StackOverflow Enterprise | New connector | Daily | Enterprise integration pain, scaling problems, tool limitations |
| G2 Reviews Trending | New connector | Daily | Software category gaps, competitor weaknesses |
| Crunchbase | BYO connector | Daily | Recent funding signals, market validation |

Enterprise subreddits are free (just config changes to existing Reddit connector). StackOverflow uses public API. G2 requires scraping. Crunchbase requires API key.

## Architecture

```
                    Signal Pipeline (shared)
                    Connectors -> Dedup -> Score
                             |
                    Profile Loader (profiles/*.ts)
                             |
              +--------------+--------------+
              |                             |
      Consumer Agent Run          B2B Agent Run
      (parallel via                (parallel via
       Promise.allSettled)          Promise.allSettled)
              |                             |
              +-------------+---------------+
                            |
                   Unified Thesis DB
                   (thesis + profile_id)
                            |
                   UI: Filterable
                   [All] [Consumer] [B2B]
                   Badge + color per type
```

### Execution

- Both profiles run **in parallel** via `Promise.allSettled` during each agent cycle
- Each profile gets its own `dualAnalystRun` call with profile-specific prompts
- If one profile fails, the other still produces theses
- Agent logs include which profile produced each thesis

### Database

- `theses` table gets `profile_id TEXT DEFAULT 'consumer'` column
- Existing theses default to 'consumer' profile
- `thesis_deep_dives` unaffected (linked by canonical_key)

### API

- `GET /v1/theses` accepts optional `?profile=consumer|b2b|all` filter (default: all)
- `GET /v1/profiles` returns list of enabled profiles with display config
- Agent status endpoint includes per-profile run status

### UI

- Filter bar: `[All] [Consumer] [B2B]` tabs above thesis list
- Each thesis card shows colored badge from profile display config
- Sort works within the filtered set
- Deep-dive prompt adapts to the thesis profile context
- Profile selector persists in URL params

### Profile Storage

- Profiles defined as TypeScript files in `apps/api/src/profiles/`
- `consumer.ts` and `b2b.ts` ship as built-in profiles
- `index.ts` exports a `loadProfiles()` function returning all enabled profiles
- Future: profiles could be user-editable via UI

## Signal Flow Per Profile

1. Shared signal pipeline runs (all connectors refresh on their cadence)
2. Profile loader reads all enabled profiles
3. For each profile (in parallel):
   a. Filter/weight signals based on profile's `signals` config
   b. Build profile-specific prompt using `prompts` config
   c. Run `dualAnalystRun` with profile prompt
   d. Score resulting theses using profile's `scoring.dimensions`
   e. Persist theses with `profile_id`
4. UI refreshes with new theses from all profiles

## Migration Path

1. Extract current hardcoded prompts/scoring into `consumer.ts` profile
2. Add `profile_id` column to theses table
3. Create `b2b.ts` profile with new prompts and scoring
4. Update research agent to iterate over profiles
5. Add new B2B connectors (enterprise subreddits first, then SO, G2, Crunchbase)
6. Update API to support profile filtering
7. Update UI with filter tabs and badges
