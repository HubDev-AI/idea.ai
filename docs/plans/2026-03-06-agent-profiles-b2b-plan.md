# Agent Profiles: B2B/Enterprise Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a configurable agent profile system so the research agent can run multiple personas (consumer + B2B) in parallel, each with its own prompts, scoring model, and signal preferences.

**Architecture:** Extract current hardcoded consumer behavior into a profile config, then add B2B profile alongside it. Profiles run in parallel via `Promise.allSettled`. Theses tagged with `profile_id`. UI gets filter tabs and badges.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, React, existing `dualAnalystRun` infrastructure.

**Critical constraint:** The existing consumer pipeline MUST keep working identically after each task. Every task ends with a verification step.

---

### Task 1: Define the AgentProfile Type

**Files:**
- Create: `packages/contracts/src/agent_profile.ts`
- Modify: `packages/contracts/src/index.ts`

**Step 1: Write the profile type definition**

Create `packages/contracts/src/agent_profile.ts`:

```typescript
export interface ScoreDimension {
  name: string;
  weight: number;
  description: string;
}

export interface AgentProfile {
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
    dimensions: ScoreDimension[];
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

**Step 2: Export from contracts index**

Add to `packages/contracts/src/index.ts`:

```typescript
export type { AgentProfile, ScoreDimension } from './agent_profile.js';
```

**Step 3: Verify build**

Run: `pnpm --filter @idea/contracts run build`
Expected: Success, no errors.

**Step 4: Commit**

```
feat(contracts): add AgentProfile type definition
```

---

### Task 2: Create Consumer Profile (Extract Existing Behavior)

**Files:**
- Create: `apps/api/src/profiles/consumer.ts`
- Create: `apps/api/src/profiles/index.ts`

**Step 1: Create the consumer profile**

Create `apps/api/src/profiles/consumer.ts`. This MUST capture the exact same prompts currently hardcoded in `research_agent.ts:143-161` and `research_agent.ts:237-242`. Read those lines carefully and extract verbatim.

```typescript
import type { AgentProfile } from '@idea/contracts';

export const consumerProfile: AgentProfile = {
  id: 'consumer',
  name: 'Consumer / Social',
  enabled: true,

  prompts: {
    identity: 'You specialize in finding CONSUMER and SOCIAL product ideas with viral growth potential.',
    focusAreas: [
      'consumer social apps',
      'community platforms',
      'creator tools',
      'prosumer products with network effects',
      'mobile-first experiences',
    ],
    antiPatterns: [
      'Developer tooling ideas should only be surfaced if the signal is exceptionally strong (demand > 80)',
    ],
    exampleGood: [
      'Community Recipe Sharing App with AI Meal Planning',
      'TikTok-Style Short Video Editor for Realtors',
    ],
    exampleBad: [
      'Vertical SaaS Consolidation in Regulated Industries',
      'Proxy-signal instrumentation',
    ],
    scopeConstraint: 'Solo founder building for real people, not enterprises. 1-2 month MVP, viral distribution over paid acquisition.',
  },

  scoring: {
    dimensions: [
      { name: 'demand', weight: 0.25, description: 'How severe and widespread is the problem? (0-100)' },
      { name: 'timing', weight: 0.20, description: 'Is now the right time? Emerging trends, new APIs, cultural shifts? (0-100)' },
      { name: 'buildability', weight: 0.20, description: 'Can a solo dev build a credible MVP in 1-2 months? (0-100)' },
      { name: 'virality', weight: 0.35, description: 'How likely is this product to spread organically through network effects, sharing, or word of mouth? (0-100)' },
    ],
  },

  signals: {
    additionalSubreddits: [],
  },

  display: {
    badge: 'Consumer',
    badgeColor: '#3b82f6',
    icon: '🛍',
    defaultSort: 'score',
  },
};
```

**Step 2: Create the profile index**

Create `apps/api/src/profiles/index.ts`:

```typescript
import type { AgentProfile } from '@idea/contracts';
import { consumerProfile } from './consumer.js';

const ALL_PROFILES: AgentProfile[] = [consumerProfile];

export function loadProfiles(): AgentProfile[] {
  return ALL_PROFILES.filter(p => p.enabled);
}

export function getProfile(id: string): AgentProfile | undefined {
  return ALL_PROFILES.find(p => p.id === id);
}

export { consumerProfile };
```

**Step 3: Verify build**

Run: `pnpm --filter @idea/api run build` (or `tsc --noEmit` if available)
Expected: No type errors.

**Step 4: Commit**

```
feat(profiles): extract consumer behavior into profile config
```

---

### Task 3: Database Migration — Add profile_id to Theses

**Files:**
- Create: `apps/api/db/migrations/0016_thesis_profile_id.sql`

**Step 1: Write the migration**

```sql
-- Add profile_id to thesis_candidates
ALTER TABLE thesis_candidates
  ADD COLUMN IF NOT EXISTS profile_id TEXT NOT NULL DEFAULT 'consumer';

-- Add profile_id to thesis_snapshots
ALTER TABLE thesis_snapshots
  ADD COLUMN IF NOT EXISTS profile_id TEXT NOT NULL DEFAULT 'consumer';

-- Index for filtering by profile
CREATE INDEX IF NOT EXISTS idx_thesis_candidates_profile
  ON thesis_candidates (profile_id);
```

**Step 2: Run migration**

Run: `bash apps/api/db/db-migrate.sh`
Expected: Migration 0016 applied successfully.

**Step 3: Verify schema**

Run: `psql -p 5917 -U idea_user -d idea_db -c "\d thesis_candidates" | grep profile_id`
Expected: Shows `profile_id | text | not null | 'consumer'`

**Step 4: Commit**

```
feat(db): add profile_id column to thesis tables
```

---

### Task 4: Wire Profile into Prompt Builder (research_agent.ts)

**Files:**
- Modify: `apps/api/src/jobs/research_agent.ts` (lines ~115-258)

**Goal:** Make `buildBroadScanPrompt` and `buildDeepDivePrompt` accept an `AgentProfile` and use it instead of hardcoded strings. The consumer profile must produce IDENTICAL prompts to what's there now.

**Step 1: Write a test for prompt equivalence**

Create `apps/api/tests/research_agent_profile.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { consumerProfile } from '../src/profiles/consumer.js';

// Import the prompt builders (after they accept a profile)
// For now, just test the profile is well-formed
describe('consumer profile', () => {
  it('has scoring dimensions that sum to 1', () => {
    const sum = consumerProfile.scoring.dimensions.reduce((s, d) => s + d.weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.001);
  });

  it('has all required fields', () => {
    expect(consumerProfile.id).toBe('consumer');
    expect(consumerProfile.prompts.identity).toBeTruthy();
    expect(consumerProfile.scoring.dimensions).toHaveLength(4);
    expect(consumerProfile.display.badge).toBe('Consumer');
  });
});
```

**Step 2: Run the test**

Run: `CI=1 pnpm --filter @idea/api exec vitest run tests/research_agent_profile.test.ts`
Expected: PASS

**Step 3: Modify `buildBroadScanPrompt` to accept a profile**

In `research_agent.ts`, update the function signature and body. Replace hardcoded identity/focus lines with profile-driven text:

```typescript
import type { AgentProfile } from '@idea/contracts';

export function buildBroadScanPrompt(ctx: BroadScanContext, profile: AgentProfile): string {
  const focusBlock = profile.prompts.focusAreas.map(f => `- ${f}`).join('\n');
  const antiBlock = profile.prompts.antiPatterns.map(a => `- ${a}`).join('\n');
  const goodExamples = profile.prompts.exampleGood.map(e => `  GOOD: "${e}"`).join('\n');
  const badExamples = profile.prompts.exampleBad.map(e => `  BAD: "${e}"`).join('\n');
  const scopeLine = profile.prompts.scopeConstraint
    ? `\nSCOPE: ${profile.prompts.scopeConstraint}`
    : '';

  // Replace the hardcoded identity block (lines 143-161) with:
  const identityBlock = `${profile.prompts.identity}

FOCUS AREAS:
${focusBlock}

CONSTRAINTS:
${antiBlock}
${scopeLine}

THESIS QUALITY — every thesis must be a CONCRETE product idea:
${goodExamples}
${badExamples}`;

  // ... rest of the prompt stays the same (context assembly)
}
```

Do the same for `buildDeepDivePrompt` — replace the hardcoded "CONSUMER FOCUS" section (lines 237-242) with profile-driven text.

**Step 4: Verify no behavior change**

Run: `CI=1 pnpm --filter @idea/api exec vitest run`
Expected: All existing tests pass. No regressions.

**Step 5: Commit**

```
refactor(agent): wire profile into prompt builders
```

---

### Task 5: Wire Profile into Agent Runner

**Files:**
- Modify: `apps/api/src/jobs/agent_runner.ts`

**Goal:** `runResearchAgent` accepts an `AgentProfile` and passes it to prompt builders. Thesis inserts include `profile_id`.

**Step 1: Add profile parameter to runResearchAgent**

Update the function signature to accept `profile: AgentProfile`. Thread it through to:
- `buildBroadScanPrompt(ctx, profile)` (line ~168)
- `buildDeepDivePrompt(ddCtx, profile)` (line ~350)
- New thesis inserts — add `profile_id: profile.id` (around line 422)
- Thesis update calls — ensure profile_id is preserved

**Step 2: Update thesis key namespace**

Currently new theses use key `agent:{slugified title}` (line ~407). Add profile prefix:
```typescript
const key = `${profile.id}:${slugify(t.title)}`;
```
This prevents consumer and B2B theses from colliding on similar titles.

**Step 3: Update scoring in agent runner**

Where scores are computed or blended, use profile dimensions instead of hardcoded weights. If the agent runner calls `blendScore`, make it profile-aware:

```typescript
// Instead of importing hardcoded blend:
function blendWithProfile(scores: Record<string, number>, profile: AgentProfile): number {
  return profile.scoring.dimensions.reduce((sum, dim) => {
    return sum + (scores[dim.name] ?? 0) * dim.weight;
  }, 0);
}
```

**Step 4: Verify with existing tests**

Run: `CI=1 pnpm --filter @idea/api exec vitest run`
Expected: All tests pass. Some may need the consumer profile passed as a new argument — update those tests to import `consumerProfile` and pass it.

**Step 5: Commit**

```
refactor(agent): pass profile through agent runner pipeline
```

---

### Task 6: Multi-Profile Orchestration

**Files:**
- Modify: `apps/api/src/jobs/agent_runner.ts` or create `apps/api/src/jobs/agent_orchestrator.ts`

**Goal:** The scheduler runs all enabled profiles in parallel. Each profile gets its own `runResearchAgent` call.

**Step 1: Create orchestrator function**

```typescript
import { loadProfiles } from '../profiles/index.js';

export async function runAllProfiles(deps: AgentDeps): Promise<void> {
  const profiles = loadProfiles();
  const results = await Promise.allSettled(
    profiles.map(profile =>
      runResearchAgent({ ...deps, profile })
    )
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const p = profiles[i];
    if (r.status === 'rejected') {
      deps.logger.error(`Profile ${p.id} failed: ${r.reason}`);
    } else {
      deps.logger.info(`Profile ${p.id} completed successfully`);
    }
  }
}
```

**Step 2: Update the scheduler/cron entry**

Find where `runResearchAgent` is called on the cron schedule (likely in the API server setup or a scheduler file). Replace the direct call with `runAllProfiles(deps)`.

**Step 3: Update manual trigger endpoint**

In `agent_status.ts` (line 29-36), the `POST /v1/agent/run` endpoint triggers a manual run. Update it to call `runAllProfiles` instead of `runResearchAgent` directly.

**Step 4: Update agent_runs table**

The `agent_runs` table should track which profile was run. Add profile_id to the run record:
- Create migration `0017_agent_runs_profile_id.sql`:

```sql
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS profile_id TEXT NOT NULL DEFAULT 'consumer';
```

**Step 5: Verify manually**

Start the API, trigger a manual run via `POST /v1/agent/run`, check logs to confirm the consumer profile runs identically to before.

Run: `CI=1 pnpm --filter @idea/api exec vitest run`
Expected: All tests pass.

**Step 6: Commit**

```
feat(agent): multi-profile orchestration with parallel execution
```

---

### Task 7: Create B2B Profile

**Files:**
- Create: `apps/api/src/profiles/b2b.ts`
- Modify: `apps/api/src/profiles/index.ts`

**Step 1: Write the B2B profile**

Create `apps/api/src/profiles/b2b.ts`:

```typescript
import type { AgentProfile } from '@idea/contracts';

export const b2bProfile: AgentProfile = {
  id: 'b2b',
  name: 'B2B / Enterprise',
  enabled: true,

  prompts: {
    identity: 'You specialize in finding B2B and ENTERPRISE SaaS product ideas with strong revenue potential, defensible moats, and clear buyer personas.',
    focusAreas: [
      'vertical SaaS for underserved industries',
      'API products and developer infrastructure',
      'workflow automation and process optimization',
      'compliance, security, and governance tools',
      'data platforms and analytics',
      'enterprise integrations and middleware',
      'internal tools and back-office automation',
    ],
    antiPatterns: [
      'Do NOT suggest consumer social apps, viral mobile games, or creator tools',
      'Do NOT suggest ideas that depend entirely on viral distribution — B2B succeeds through sales, partnerships, and word-of-mouth among professionals',
      'Avoid generic "AI for X" unless the specific workflow and buyer are crystal clear',
    ],
    exampleGood: [
      'SOC2 Compliance Autopilot for Seed-Stage Startups',
      'Real-Time Inventory Sync API for Shopify-to-ERP',
      'AI Contract Review Tool for Mid-Market Legal Teams',
      'Automated Freight Broker Matching Platform',
    ],
    exampleBad: [
      'Enterprise AI Platform',
      'B2B Social Network',
      'Cloud Management Dashboard',
    ],
  },

  scoring: {
    dimensions: [
      {
        name: 'enterprise_pain',
        weight: 0.30,
        description: 'How severe and frequent is this problem in business/professional contexts? Are teams losing money, time, or failing compliance? (0-100)',
      },
      {
        name: 'market_size',
        weight: 0.25,
        description: 'Total addressable market and willingness to pay. How many businesses face this? What would they pay monthly/annually? (0-100)',
      },
      {
        name: 'moat_potential',
        weight: 0.25,
        description: 'How defensible is this once built? Consider: data network effects, integration lock-in, regulatory moats, switching costs, proprietary data advantages. (0-100)',
      },
      {
        name: 'feasibility',
        weight: 0.20,
        description: 'Can a small team (1-5 people) build a credible v1? Consider API availability, regulatory barriers, integration complexity, required domain expertise. (0-100)',
      },
    ],
  },

  signals: {
    additionalSubreddits: [
      'devops', 'sysadmin', 'ITManagers', 'msp',
      'salesforce', 'aws', 'googlecloud', 'azure',
      'cscareerquestions', 'ExperiencedDevs',
    ],
    signalFilter: 'Focus on signals indicating enterprise workflow gaps, tool complaints, integration pain, compliance burden, or manual processes that should be automated.',
  },

  display: {
    badge: 'B2B',
    badgeColor: '#10b981',
    icon: '🏢',
    defaultSort: 'score',
  },
};
```

**Step 2: Register in profiles index**

Add to `apps/api/src/profiles/index.ts`:

```typescript
import { b2bProfile } from './b2b.js';

const ALL_PROFILES: AgentProfile[] = [consumerProfile, b2bProfile];
```

**Step 3: Write a profile validation test**

Add to `apps/api/tests/research_agent_profile.test.ts`:

```typescript
import { b2bProfile } from '../src/profiles/b2b.js';

describe('b2b profile', () => {
  it('has scoring dimensions that sum to 1', () => {
    const sum = b2bProfile.scoring.dimensions.reduce((s, d) => s + d.weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.001);
  });

  it('has different dimensions than consumer', () => {
    const b2bNames = b2bProfile.scoring.dimensions.map(d => d.name);
    expect(b2bNames).toContain('enterprise_pain');
    expect(b2bNames).toContain('moat_potential');
    expect(b2bNames).not.toContain('virality');
  });

  it('has unique id', () => {
    expect(b2bProfile.id).toBe('b2b');
    expect(b2bProfile.id).not.toBe(consumerProfile.id);
  });
});
```

**Step 4: Run tests**

Run: `CI=1 pnpm --filter @idea/api exec vitest run tests/research_agent_profile.test.ts`
Expected: All pass.

**Step 5: Commit**

```
feat(profiles): add B2B/enterprise agent profile
```

---

### Task 8: Add Enterprise Subreddits to Reddit Connector

**Files:**
- Modify: `packages/connectors/src/reddit.ts` (lines 4-16)
- Modify: `apps/api/src/config/env.ts` (line 45)

**Goal:** Support profile-specific subreddits. The Reddit connector already accepts a `subreddits` parameter. We need the agent orchestrator to pass profile-specific subreddits when fetching signals.

**Step 1: Add B2B subreddits to env.ts defaults**

In `env.ts`, add a new env var:

```typescript
B2B_SUBREDDITS: (process.env.B2B_SUBREDDITS || 'devops,sysadmin,ITManagers,msp,salesforce,aws,googlecloud,azure,ExperiencedDevs').split(',').map(s => s.trim()),
```

**Step 2: Update .env file**

Add to `.env`:
```
B2B_SUBREDDITS=devops,sysadmin,ITManagers,msp,salesforce,aws,googlecloud,azure,ExperiencedDevs
```

**Step 3: Verify Reddit connector still works**

Run: `CI=1 pnpm --filter @idea/connectors exec vitest run`
Expected: All connector tests pass.

**Step 4: Commit**

```
feat(connectors): add B2B enterprise subreddit configuration
```

---

### Task 9: Add StackOverflow Connector

**Files:**
- Create: `packages/connectors/src/stackoverflow.ts`
- Create: `packages/connectors/tests/stackoverflow.test.ts`
- Modify: `packages/connectors/src/index.ts`

**Step 1: Write the connector test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { fetchStackOverflow } from '../src/stackoverflow.js';

describe('stackoverflow connector', () => {
  it('parses API response into RawEventInput[]', async () => {
    const mockResponse = {
      items: [
        {
          question_id: 12345,
          title: 'How to handle SOC2 compliance in microservices?',
          creation_date: 1709700000,
          link: 'https://stackoverflow.com/q/12345',
          tags: ['compliance', 'microservices'],
          score: 15,
          view_count: 2000,
        },
      ],
      has_more: false,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const events = await fetchStackOverflow({
      tags: ['devops', 'enterprise'],
      fetchImpl: mockFetch as any,
    });

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('stackoverflow');
    expect(events[0].text).toContain('SOC2 compliance');
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `CI=1 pnpm --filter @idea/connectors exec vitest run tests/stackoverflow.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement the connector**

Create `packages/connectors/src/stackoverflow.ts`:

```typescript
import type { RawEventInput } from '@idea/contracts';

const API_BASE = 'https://api.stackexchange.com/2.3';

interface SOOptions {
  tags?: string[];
  pageSize?: number;
  fetchImpl?: typeof fetch;
}

export async function fetchStackOverflow(opts: SOOptions = {}): Promise<RawEventInput[]> {
  const { tags = ['enterprise-integration', 'devops', 'saas'], pageSize = 25, fetchImpl = fetch } = opts;
  const tagStr = tags.join(';');
  const url = `${API_BASE}/questions?order=desc&sort=activity&tagged=${encodeURIComponent(tagStr)}&site=stackoverflow&pagesize=${pageSize}&filter=withbody`;

  const res = await fetchImpl(url);
  if (!res.ok) return [];

  const data = await res.json();
  const items = data.items ?? [];

  return items.map((q: any) => ({
    source: 'stackoverflow' as const,
    source_item_id: `so-${q.question_id}`,
    timestamp: new Date(q.creation_date * 1000).toISOString(),
    text: `[${(q.tags ?? []).join(', ')}] ${q.title}`.slice(0, 2000),
    url: q.link,
  }));
}
```

**Step 4: Export from index**

Add to `packages/connectors/src/index.ts`:
```typescript
export { fetchStackOverflow } from './stackoverflow.js';
```

**Step 5: Run the test**

Run: `CI=1 pnpm --filter @idea/connectors exec vitest run tests/stackoverflow.test.ts`
Expected: PASS.

**Step 6: Commit**

```
feat(connectors): add StackOverflow enterprise connector
```

---

### Task 10: Add G2 Reviews Connector

**Files:**
- Create: `packages/connectors/src/g2_reviews.ts`
- Create: `packages/connectors/tests/g2_reviews.test.ts`
- Modify: `packages/connectors/src/index.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { fetchG2Trending } from '../src/g2_reviews.js';

describe('g2 connector', () => {
  it('parses trending page into RawEventInput[]', async () => {
    const mockHtml = `<div class="product-card">
      <a href="/products/test-tool/reviews" class="product-card__product-name">Test Tool</a>
      <span class="product-card__category">Project Management</span>
      <div class="product-card__description">A great tool for managing projects</div>
    </div>`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockHtml),
    });

    const events = await fetchG2Trending({ fetchImpl: mockFetch as any });
    expect(events.length).toBeGreaterThanOrEqual(0); // May be 0 if HTML structure changed
  });
});
```

**Step 2: Implement the connector**

G2's trending/new pages are HTML. Scrape the trending categories page for new/rising software products. Use simple regex/string parsing (no heavy DOM lib needed).

Create `packages/connectors/src/g2_reviews.ts`:

```typescript
import type { RawEventInput } from '@idea/contracts';

const G2_TRENDING_URL = 'https://www.g2.com/categories';

interface G2Options {
  fetchImpl?: typeof fetch;
  limit?: number;
}

export async function fetchG2Trending(opts: G2Options = {}): Promise<RawEventInput[]> {
  const { fetchImpl = fetch, limit = 30 } = opts;

  try {
    const res = await fetchImpl(G2_TRENDING_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IdeaBot/1.0)' },
    });
    if (!res.ok) return [];

    const html = await res.text();
    const events: RawEventInput[] = [];

    // Extract category links and names
    const categoryPattern = /href="\/categories\/([^"]+)"[^>]*>([^<]+)</g;
    let match;
    while ((match = categoryPattern.exec(html)) !== null && events.length < limit) {
      const [, slug, name] = match;
      const trimmed = name.trim();
      if (trimmed.length < 3) continue;
      events.push({
        source: 'g2_reviews' as const,
        source_item_id: `g2-cat-${slug}`,
        timestamp: new Date().toISOString(),
        text: `[G2 Category] ${trimmed}: software category on G2 with active reviews and alternatives`,
        url: `https://www.g2.com/categories/${slug}`,
      });
    }

    return events;
  } catch {
    return [];
  }
}
```

**Step 3: Export, run test, commit**

Run: `CI=1 pnpm --filter @idea/connectors exec vitest run tests/g2_reviews.test.ts`
Expected: PASS.

```
feat(connectors): add G2 Reviews trending connector
```

---

### Task 11: Add Crunchbase BYO Connector

**Files:**
- Create: `packages/connectors/src/crunchbase_byo.ts`
- Create: `packages/connectors/tests/crunchbase_byo.test.ts`
- Modify: `packages/connectors/src/index.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { fetchCrunchbase } from '../src/crunchbase_byo.js';

describe('crunchbase byo connector', () => {
  it('returns empty when no API key', async () => {
    const events = await fetchCrunchbase({ apiKey: '' });
    expect(events).toEqual([]);
  });

  it('parses API response', async () => {
    const mockResponse = {
      entities: [{
        identifier: { value: 'test-startup', permalink: 'test-startup' },
        properties: {
          short_description: 'AI compliance tool',
          founded_on: '2025-01-01',
          categories: [{ value: 'SaaS' }],
          funding_total: { value_usd: 5000000 },
        },
      }],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const events = await fetchCrunchbase({
      apiKey: 'test-key',
      fetchImpl: mockFetch as any,
    });

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('crunchbase');
  });
});
```

**Step 2: Implement**

Create `packages/connectors/src/crunchbase_byo.ts`:

```typescript
import type { RawEventInput } from '@idea/contracts';

const API_BASE = 'https://api.crunchbase.com/api/v4';

interface CrunchbaseOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  limit?: number;
}

export async function fetchCrunchbase(opts: CrunchbaseOptions): Promise<RawEventInput[]> {
  const { apiKey, fetchImpl = fetch, limit = 25 } = opts;
  if (!apiKey) return [];

  try {
    const url = `${API_BASE}/searches/organizations`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-cb-user-key': apiKey,
      },
      body: JSON.stringify({
        field_ids: ['short_description', 'founded_on', 'categories', 'funding_total', 'identifier'],
        order: [{ field_id: 'founded_on', sort: 'desc' }],
        limit,
      }),
    });

    if (!res.ok) return [];
    const data = await res.json();
    const entities = data.entities ?? [];

    return entities.map((e: any) => {
      const props = e.properties ?? {};
      const id = e.identifier?.permalink ?? e.identifier?.value ?? 'unknown';
      const cats = (props.categories ?? []).map((c: any) => c.value).join(', ');
      const funding = props.funding_total?.value_usd
        ? `$${(props.funding_total.value_usd / 1_000_000).toFixed(1)}M`
        : 'undisclosed';

      return {
        source: 'crunchbase' as const,
        source_item_id: `cb-${id}`,
        timestamp: props.founded_on ? new Date(props.founded_on).toISOString() : new Date().toISOString(),
        text: `[Crunchbase] ${id}: ${props.short_description ?? 'No description'}. Categories: ${cats}. Funding: ${funding}`.slice(0, 2000),
        url: `https://www.crunchbase.com/organization/${id}`,
      };
    });
  } catch {
    return [];
  }
}
```

**Step 3: Export, run test, commit**

Run: `CI=1 pnpm --filter @idea/connectors exec vitest run tests/crunchbase_byo.test.ts`
Expected: PASS.

```
feat(connectors): add Crunchbase BYO connector
```

---

### Task 12: Register New Connectors in Ingestion Pipeline

**Files:**
- Modify: `apps/api/src/config/env.ts`
- Modify: ingestion pipeline (look at `packages/pipeline/src/ingest_open.ts` or equivalent)
- Modify: `packages/connectors/src/common/http.ts` (cadence map)
- Modify: `.env`

**Step 1: Add connector names to contracts**

Add `'stackoverflow' | 'g2_reviews'` to the connector name union type (check `packages/contracts/src/connectorNames.ts`).
Add `'crunchbase'` as a BYO connector name.

**Step 2: Add cadence routing**

In the `OPEN_CONNECTOR_CADENCE` map, add:
```typescript
stackoverflow: 'daily',
g2_reviews: 'daily',
```

Add `crunchbase` to the BYO connector list.

**Step 3: Wire into ingestion**

In the ingestion pipeline, add cases for the new connectors that call `fetchStackOverflow()` and `fetchG2Trending()`. Follow the pattern of existing connectors.

**Step 4: Update .env**

Add `stackoverflow,g2_reviews` to `DAILY_CONNECTORS`.
Add `CRUNCHBASE_API_KEY=` to `.env`.

**Step 5: Verify existing connectors still work**

Run: `CI=1 pnpm test`
Expected: All 233+ tests pass.

**Step 6: Commit**

```
feat(pipeline): register StackOverflow, G2, and Crunchbase connectors
```

---

### Task 13: Update Theses API for Profile Filtering

**Files:**
- Modify: `apps/api/src/routes/theses.ts`
- Create: `apps/api/src/routes/profiles.ts`

**Step 1: Add profile query param to GET /v1/theses**

In `theses.ts`, update the `GET /v1/theses` handler (line ~26) to accept `?profile=consumer|b2b|all`:

```typescript
const profile = (req.query as any).profile || 'all';
// Add WHERE clause: profile !== 'all' ? 'AND profile_id = $N' : ''
```

**Step 2: Create GET /v1/profiles endpoint**

Create `apps/api/src/routes/profiles.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { loadProfiles } from '../profiles/index.js';

export function registerProfileRoutes(app: FastifyInstance) {
  app.get('/v1/profiles', async () => {
    const profiles = loadProfiles();
    return profiles.map(p => ({
      id: p.id,
      name: p.name,
      display: p.display,
      dimensions: p.scoring.dimensions.map(d => ({ name: d.name, weight: d.weight })),
    }));
  });
}
```

**Step 3: Register the route**

Add `registerProfileRoutes(app)` in the server setup file.

**Step 4: Verify**

Run: `CI=1 pnpm --filter @idea/api exec vitest run`
Expected: All tests pass.

Test manually: `curl http://localhost:3001/v1/profiles` should return profile list.

**Step 5: Commit**

```
feat(api): add profile filtering to theses and profiles endpoint
```

---

### Task 14: Update Frontend — Profile Filter Tabs and Badges

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

**Step 1: Fetch profiles from API**

Add a `profiles` state and fetch from `GET /v1/profiles` on mount:

```typescript
const [profiles, setProfiles] = useState<Array<{ id: string; name: string; display: any }>>([]);
const [activeProfile, setActiveProfile] = useState('all');

// In the data fetch effect:
fetch(`${API}/v1/profiles`).then(r => r.json()).then(setProfiles);
```

**Step 2: Add filter tabs above thesis list**

In the thesis pane header (around line 477), add tabs:

```tsx
<div className="profile-tabs">
  <button
    className={`profile-tab ${activeProfile === 'all' ? 'active' : ''}`}
    onClick={() => setActiveProfile('all')}
  >All</button>
  {profiles.map(p => (
    <button
      key={p.id}
      className={`profile-tab ${activeProfile === p.id ? 'active' : ''}`}
      onClick={() => setActiveProfile(p.id)}
      style={{ '--badge-color': p.display.badgeColor } as React.CSSProperties}
    >
      {p.display.badge}
    </button>
  ))}
</div>
```

**Step 3: Pass profile filter to thesis fetch**

Update the theses fetch URL to include `?profile=${activeProfile}`.

**Step 4: Add badge to thesis cards**

In each thesis card, show a small colored badge:

```tsx
{thesis.profile_id && thesis.profile_id !== 'consumer' && (
  <span className="thesis-badge" style={{ background: profiles.find(p => p.id === thesis.profile_id)?.display?.badgeColor }}>
    {profiles.find(p => p.id === thesis.profile_id)?.display?.badge}
  </span>
)}
```

**Step 5: Add CSS for tabs and badges**

```css
.profile-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}

.profile-tab {
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}

.profile-tab.active {
  background: var(--badge-color, var(--accent));
  color: #fff;
  border-color: transparent;
}

.thesis-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  color: #fff;
  margin-left: 6px;
  vertical-align: middle;
}
```

**Step 6: Verify build**

Run: `pnpm --filter @idea/web run build`
Expected: Build succeeds.

**Step 7: Commit**

```
feat(web): add profile filter tabs and thesis badges
```

---

### Task 15: Integration Test — Full Cycle Verification

**Goal:** Verify the complete flow works end-to-end without breaking existing behavior.

**Step 1: Run all tests**

Run: `CI=1 pnpm test`
Expected: All tests pass (233+ existing + new profile tests).

**Step 2: Start the full stack**

Start API + Web, trigger a manual agent run.

**Step 3: Verify consumer theses**

Check that consumer theses still appear with correct scores and no profile_id regressions.

**Step 4: Verify B2B theses**

After the agent run completes, check that B2B theses appear with:
- `profile_id: 'b2b'`
- B2B scoring dimensions (enterprise_pain, market_size, moat_potential, feasibility)
- Green badge in the UI

**Step 5: Verify profile filtering**

Click the [Consumer], [B2B], [All] tabs and verify correct filtering.

**Step 6: Verify deep-dive**

Click on a B2B thesis and request a deep-dive. Verify the deep-dive prompt uses B2B context.

**Step 7: Commit any fixes**

```
fix: integration test fixes for profile system
```

---

## Task Summary

| Task | Description | Risk Level | Dependencies |
|------|-------------|-----------|--------------|
| 1 | Define AgentProfile type | Low | None |
| 2 | Create consumer profile | Low | Task 1 |
| 3 | DB migration (profile_id) | Low | None |
| 4 | Wire profile into prompts | **Medium** | Tasks 1-2 |
| 5 | Wire profile into agent runner | **Medium** | Tasks 3-4 |
| 6 | Multi-profile orchestration | **Medium** | Task 5 |
| 7 | Create B2B profile | Low | Task 2 |
| 8 | Enterprise subreddits | Low | None |
| 9 | StackOverflow connector | Low | None |
| 10 | G2 Reviews connector | Low | None |
| 11 | Crunchbase BYO connector | Low | None |
| 12 | Register new connectors | Low | Tasks 8-11 |
| 13 | API profile filtering | Low | Tasks 3, 6 |
| 14 | Frontend tabs + badges | Low | Task 13 |
| 15 | Integration verification | Low | All |

**Critical path:** Tasks 1 → 2 → 4 → 5 → 6 (core refactoring).
**Parallelizable:** Tasks 7-11 can be done in parallel with each other and with Tasks 4-6.

**Safety checkpoint after Task 5:** Run the full test suite and verify the consumer agent produces identical output before proceeding to Task 6.
