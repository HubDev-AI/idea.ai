# Social/Viral Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Broaden the Sixth Sense engine from enterprise SaaS to viral/social app opportunity detection with new connectors, 4-dimension scoring, and updated AI prompts.

**Architecture:** Three sequential PRs — (1) scoring overhaul (types, DB, blend formula, AI prompts, UI), (2) new connectors (Twitter, TikTok, App Store, IndieHackers, expanded Reddit), (3) agent intelligence (research agent prompts, virality in theses).

**Tech Stack:** TypeScript, Fastify 5, PostgreSQL, React 18, Vitest, pnpm monorepo

---

## PR 1: Scoring Overhaul

---

### Task 1: DB migration — rename pain to demand, add virality column

**Files:**
- Create: `apps/api/db/migrations/0012_demand_virality.sql`

**Step 1: Create the migration**

```sql
-- Rename pain → demand across signal_memory
ALTER TABLE signal_memory RENAME COLUMN pain TO demand;

-- Add virality column (nullable for backward compat with existing signals)
ALTER TABLE signal_memory ADD COLUMN virality NUMERIC(5,2);
```

**Step 2: Verify migration syntax**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && cat apps/api/db/migrations/0012_demand_virality.sql`
Expected: Shows the SQL above

**Step 3: Commit**

```bash
git add apps/api/db/migrations/0012_demand_virality.sql
git commit -m "feat: add migration to rename pain→demand and add virality column"
```

---

### Task 2: Update blend formula to 4 dimensions

**Files:**
- Modify: `packages/pipeline/src/scoring/blend.ts`
- Modify: `packages/pipeline/tests/scoring.test.ts`

**Step 1: Update the Scores type and blendedScore function**

In `packages/pipeline/src/scoring/blend.ts`, replace the entire file:

```typescript
export type Scores = {
  demand: number;
  timing: number;
  buildability: number;
  virality: number;
};

/** Backward-compatible alias for code that still passes the old shape. */
export type LegacyScores = {
  pain: number;
  timing: number;
  buildability: number;
};

const isLegacy = (s: Scores | LegacyScores): s is LegacyScores =>
  'pain' in s && !('demand' in s);

export const blendedScore = (scores: Scores | LegacyScores): number => {
  if (isLegacy(scores)) {
    // Old callers: treat pain as demand, virality defaults to 0
    return Math.round((0.25 * scores.pain + 0.20 * scores.timing + 0.20 * scores.buildability) * 100) / 100;
  }
  return Math.round(
    (0.25 * scores.demand + 0.20 * scores.timing + 0.20 * scores.buildability + 0.35 * scores.virality) * 100
  ) / 100;
};
```

**Step 2: Update scoring tests**

In `packages/pipeline/tests/scoring.test.ts`, find the test that calls `blendedScore` and update it. Add tests for both new and legacy shapes:

```typescript
it('blends 4-dimension scores with correct weights', () => {
  expect(blendedScore({ demand: 80, timing: 60, buildability: 50, virality: 90 })).toBe(
    Math.round((0.25 * 80 + 0.20 * 60 + 0.20 * 50 + 0.35 * 90) * 100) / 100
  );
});

it('handles legacy 3-dimension scores (pain as demand, no virality)', () => {
  expect(blendedScore({ pain: 80, timing: 60, buildability: 50 })).toBe(
    Math.round((0.25 * 80 + 0.20 * 60 + 0.20 * 50) * 100) / 100
  );
});
```

**Step 3: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run packages/pipeline/tests/scoring.test.ts`
Expected: All pass

**Step 4: Commit**

```bash
git add packages/pipeline/src/scoring/blend.ts packages/pipeline/tests/scoring.test.ts
git commit -m "feat: update blend formula to 4 dimensions (demand/timing/buildability/virality)"
```

---

### Task 3: Update ScoreTriplet to ScoreQuad in dual_analyst

**Files:**
- Modify: `packages/ai-runtime/src/dual_analyst.ts`
- Modify: `packages/ai-runtime/tests/dual-analyst.test.ts`

**Step 1: Update the types**

In `packages/ai-runtime/src/dual_analyst.ts`, update:

```typescript
export type ScoreTriplet = { pain: number; timing: number; buildability: number };
```

to:

```typescript
/** @deprecated Use ScoreQuad instead */
export type ScoreTriplet = { pain: number; timing: number; buildability: number };

export type ScoreQuad = { demand: number; timing: number; buildability: number; virality: number };

export type ReconciledScore = ScoreQuad & {
  agreement: 'aligned' | 'contested' | 'single' | 'unavailable';
  contestedDimensions: string[];
};
```

**Step 2: Update reconcileScores**

Update the function signature and body to use `ScoreQuad`:

```typescript
export const reconcileScores = (
  claudeScores: ScoreQuad | null,
  codexScores: ScoreQuad | null
): ReconciledScore => {
  if (!claudeScores && !codexScores) {
    return { demand: 0, timing: 0, buildability: 0, virality: 0, agreement: 'unavailable', contestedDimensions: [] };
  }

  if (!claudeScores || !codexScores) {
    const s = (claudeScores ?? codexScores)!;
    return { ...s, agreement: 'single', contestedDimensions: [] };
  }

  const contested: string[] = [];
  for (const dim of ['demand', 'timing', 'buildability', 'virality'] as const) {
    if (Math.abs(claudeScores[dim] - codexScores[dim]) > DISAGREEMENT_THRESHOLD) {
      contested.push(dim);
    }
  }

  return {
    demand: avg(claudeScores.demand, codexScores.demand),
    timing: avg(claudeScores.timing, codexScores.timing),
    buildability: avg(claudeScores.buildability, codexScores.buildability),
    virality: avg(claudeScores.virality, codexScores.virality),
    agreement: contested.length > 0 ? 'contested' : 'aligned',
    contestedDimensions: contested
  };
};
```

**Step 3: Update dual-analyst tests**

Update `packages/ai-runtime/tests/dual-analyst.test.ts` to use ScoreQuad shape (demand/virality instead of pain). Keep the existing test structure but update field names.

**Step 4: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run packages/ai-runtime/tests/dual-analyst.test.ts`
Expected: All pass

**Step 5: Commit**

```bash
git add packages/ai-runtime/src/dual_analyst.ts packages/ai-runtime/tests/dual-analyst.test.ts
git commit -m "feat: update ScoreTriplet to ScoreQuad with demand/virality dimensions"
```

---

### Task 4: Update FeedRecord and contracts types

**Files:**
- Modify: `packages/contracts/src/api.ts`

**Step 1: Update FeedRecord**

In `packages/contracts/src/api.ts`, change the `FeedRecord` type:

Replace `pain?: number;` with `demand?: number;` and add `virality?: number;` after buildability:

```typescript
export type FeedRecord = {
  idea: string;
  score: number;
  top_source: string;
  snippet: string;
  source_url: string | null;
  next_action: 'validate_demand' | 'validate_pricing' | 'validate_channel';
  updated_at: string;
  demand?: number;
  timing?: number;
  buildability?: number;
  virality?: number;
  reasoning?: string;
};
```

**Step 2: Commit**

```bash
git add packages/contracts/src/api.ts
git commit -m "feat: update FeedRecord type — pain→demand, add virality"
```

---

### Task 5: Update postgres_memory_store — column references

**Files:**
- Modify: `apps/api/src/runtime/postgres_memory_store.ts`

**Step 1: Find and replace all `pain` column references**

In `postgres_memory_store.ts`, rename all SQL column references from `pain` to `demand`. This includes:
- INSERT statements: `pain` → `demand`
- SELECT statements: `pain` → `demand`
- The `SimilarRow` type: `pain` → `demand`
- Result mapping: `pain: row.pain` → `demand: row.demand`

Also add `virality` to INSERT/SELECT where the other score columns appear.

**Step 2: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run apps/api/tests/postgres_memory_store.test.ts`
Expected: All pass (tests use in-memory mocks, not real DB columns)

**Step 3: Commit**

```bash
git add apps/api/src/runtime/postgres_memory_store.ts
git commit -m "feat: update memory store SQL — pain→demand, add virality column"
```

---

### Task 6: Update pipeline scoring types and score.ts

**Files:**
- Modify: `packages/pipeline/src/rank.ts` — update `SignalWithBlend` type
- Modify: `packages/pipeline/src/scoring/score.ts` — update score aggregation
- Modify: `apps/api/src/jobs/rank_publish.ts` — update `RankedPublishSignal`

**Step 1: Update SignalWithBlend**

In `packages/pipeline/src/rank.ts`:

```typescript
export type SignalWithBlend = {
  id: string;
  blended: number;
  demand: number;
  timing: number;
  buildability: number;
  virality: number;
};
```

**Step 2: Update score.ts**

In the score aggregation function, rename `pain` → `demand` and add `virality` (default 0 when AI doesn't provide it, populated from AI post-scrape when available).

**Step 3: Update rank_publish.ts**

Update the `FeedRecord` mapping to use `demand` instead of `pain` and include `virality`:

```typescript
demand: signal.demand,
timing: signal.timing,
buildability: signal.buildability,
virality: signal.virality,
```

**Step 4: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run`
Expected: All pass

**Step 5: Commit**

```bash
git add packages/pipeline/src/rank.ts packages/pipeline/src/scoring/score.ts apps/api/src/jobs/rank_publish.ts
git commit -m "feat: update pipeline types and scoring — pain→demand, add virality"
```

---

### Task 7: Update ai_post_scrape prompt

**Files:**
- Modify: `apps/api/src/jobs/ai_post_scrape.ts`
- Modify: `apps/api/tests/ai-post-scrape.test.ts`

**Step 1: Update the prompt**

In `apps/api/src/jobs/ai_post_scrape.ts`, update `buildPrompt` (lines 153-178):

Replace the prompt lines:
```
'You are a strict SaaS opportunity analyst.',
```
with:
```
'You are a product opportunity analyst specializing in viral and high-growth products.',
'Analyze signals for market opportunity — consumer apps, social platforms, viral tools, B2B products with network effects.',
```

Update the output format line:
```
'{"signals":[{"id":"...","idea":"...","demand":0-100,"timing":0-100,"virality":0-100,"judge_scores":[0-100,0-100,0-100],"confidence":0-1,"is_noise":false,"rationale":"short"}]}',
```

Update the rules:
```
'- idea must be a market-facing product opportunity title, max 90 chars.',
'- demand and timing are integers from 0 to 100.',
'- virality is an integer from 0 to 100 measuring network effects, shareability, and growth loop potential.',
```

**Step 2: Update the AiPostScrapeInsight type**

Add `virality` field:
```typescript
export type AiPostScrapeInsight = {
  id: string;
  idea?: string;
  demand?: number;    // was: pain
  timing?: number;
  virality?: number;  // NEW
  judgeScores?: [number, number, number];
  confidence?: number;
  isNoise?: boolean;
  rationale?: string;
};
```

**Step 3: Update parseAiPostScrapeInsights**

Add virality parsing alongside the existing pain/timing parsing:
```typescript
const demand    = Number.isFinite(Number(row.demand ?? row.pain)) ? clampScore(Number(row.demand ?? row.pain)) : undefined;
const virality  = Number.isFinite(Number(row.virality)) ? clampScore(Number(row.virality)) : undefined;
```

Note: `row.demand ?? row.pain` provides backward compatibility with AI responses that might still use `pain`.

**Step 4: Update tests**

In `apps/api/tests/ai-post-scrape.test.ts`, update mock AI responses to include `demand` and `virality` instead of `pain`.

**Step 5: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run apps/api/tests/ai-post-scrape.test.ts`
Expected: All pass

**Step 6: Commit**

```bash
git add apps/api/src/jobs/ai_post_scrape.ts apps/api/tests/ai-post-scrape.test.ts
git commit -m "feat: update post-scrape prompt — broaden to viral/social, add virality score"
```

---

### Task 8: Update ai_judges prompt

**Files:**
- Modify: `apps/api/src/jobs/ai_judges.ts`

**Step 1: Update the judge prompt**

In `apps/api/src/jobs/ai_judges.ts`, update `buildJudgePrompt` (lines 77-97):

Replace:
```
'You are evaluating a possible SaaS product for a solo founder.',
```
with:
```
'You are evaluating a product idea for buildability.',
```

**Step 2: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run apps/api/tests/ai-judges.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add apps/api/src/jobs/ai_judges.ts
git commit -m "feat: broaden AI judge prompt from solo-founder SaaS to general product"
```

---

### Task 9: Update live_read_model scoring flow

**Files:**
- Modify: `apps/api/src/runtime/live_read_model.ts`

**Step 1: Update the scoredSignals type**

In `live_read_model.ts`, find the `scoredSignals` array type (around line 651) and update:

```typescript
const scoredSignals: Array<{
  id: string;
  idea: string;
  top_source: string;
  snippet: string;
  source_url: string | null;
  demand: number;
  timing: number;
  buildability: number;
  virality: number;
  blended: number;
}> = [];
```

**Step 2: Update signal scoring population**

Where scored signals are pushed (around line 801), rename `pain` → `demand` and add `virality` (from AI insight if available, else 0):

```typescript
scoredSignals.push({
  id: signal.id,
  idea: signal.idea,
  top_source: signal.top_source,
  snippet: signal.snippet,
  source_url: signal.source_url,
  demand: aiInsight?.demand ?? score.demand,
  timing: score.timing,
  buildability: score.buildability,
  virality: aiInsight?.virality ?? 0,
  blended: score.blended
});
```

**Step 3: Update snapshot hydration**

In the snapshot hydration code (around line 415), rename `pain` → `demand` and add `virality`:

```typescript
...(typeof entry.demand === 'number' ? { demand: entry.demand } : typeof entry.pain === 'number' ? { demand: entry.pain } : {}),
...(typeof entry.virality === 'number' ? { virality: entry.virality } : {}),
```

**Step 4: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run`
Expected: All pass

**Step 5: Commit**

```bash
git add apps/api/src/runtime/live_read_model.ts
git commit -m "feat: update live read model scoring flow — pain→demand, add virality"
```

---

### Task 10: Update feed route — signalToFeedRecord

**Files:**
- Modify: `apps/api/src/routes/feed.ts`

**Step 1: Update signalToFeedRecord mapping**

In `apps/api/src/routes/feed.ts`, update `signalToFeedRecord` (around line 66):

```typescript
const signalToFeedRecord = (row: MemorySignalRow): FeedRecord => ({
  idea: row.canonical_text,
  score: row.blended,
  top_source: row.source,
  snippet: row.canonical_text.slice(0, 200),
  source_url: row.source_url ?? null,
  next_action: 'validate_demand',
  updated_at: row.observed_at,
  demand: row.demand,
  timing: row.timing,
  buildability: row.buildability,
  virality: row.virality ?? undefined,
});
```

Also update the `MemorySignalRow` type if it exists in this file — rename `pain` → `demand`, add `virality`.

**Step 2: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run apps/api/tests/feed.test.ts`
Expected: All pass

**Step 3: Commit**

```bash
git add apps/api/src/routes/feed.ts
git commit -m "feat: update feed route — pain→demand, add virality to FeedRecord"
```

---

### Task 11: Update UI — SignalRow chips

**Files:**
- Modify: `apps/web/src/components/SignalRow.tsx`
- Modify: `apps/web/tests/signal-row.test.tsx`

**Step 1: Update SignalRow component**

In `apps/web/src/components/SignalRow.tsx`:

1. Update `hasBreakdown` to check `demand` instead of `pain`, add `virality`:
```typescript
const hasBreakdown = (signal: SignalRecord): boolean =>
  signal.demand != null || signal.timing != null || signal.buildability != null || signal.virality != null;
```

2. Update the breakdown chips rendering:
```typescript
{signal.demand != null && <span className="breakdown-chip">Demand <strong>{signal.demand}</strong></span>}
{signal.timing != null && <span className="breakdown-chip">Timing <strong>{signal.timing}</strong></span>}
{signal.buildability != null && <span className="breakdown-chip">Build <strong>{signal.buildability}</strong></span>}
{signal.virality != null && <span className="breakdown-chip breakdown-chip-viral">Viral <strong>{signal.virality}</strong></span>}
```

**Step 2: Update signal-row tests**

In `apps/web/tests/signal-row.test.tsx`:

1. Update `baseSignal` — no `pain` field (it won't exist on new signals).
2. Update the breakdown test to use `demand` and `virality`:
```typescript
it('renders breakdown chips when demand/timing/buildability/virality are present', () => {
  render(
    <SignalRow signal={{ ...baseSignal, demand: 72, timing: 61, buildability: 55, virality: 85 }} />
  );

  expect(screen.getByText('72')).toBeTruthy();
  expect(screen.getByText('61')).toBeTruthy();
  expect(screen.getByText('55')).toBeTruthy();
  expect(screen.getByText('85')).toBeTruthy();
  expect(screen.getByText('Demand')).toBeTruthy();
  expect(screen.getByText('Timing')).toBeTruthy();
  expect(screen.getByText('Build')).toBeTruthy();
  expect(screen.getByText('Viral')).toBeTruthy();
});
```

3. Update the "hides breakdown chips" test to check for `Demand` not `Pain`.

**Step 3: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run apps/web/tests/signal-row.test.tsx`
Expected: All pass

**Step 4: Commit**

```bash
git add apps/web/src/components/SignalRow.tsx apps/web/tests/signal-row.test.tsx
git commit -m "feat: update SignalRow chips — Pain→Demand, add Viral chip"
```

---

### Task 12: Update thesis types — add virality

**Files:**
- Modify: `apps/api/src/jobs/thesis_synthesizer.ts`
- Modify: `apps/api/src/runtime/postgres_thesis_store.ts`

**Step 1: Update ThesisDraft type**

In `thesis_synthesizer.ts`, rename `avgPain` → `avgDemand` in the `ThesisDraft` type and add `avgVirality`:

```typescript
avgDemand: number;        // was: avgPain
avgTiming: number;
avgBuildability: number;
avgVirality: number;      // NEW
```

**Step 2: Update buildConfidence formula**

In `thesis_synthesizer.ts`, update the confidence formula to include virality:

```typescript
const buildConfidence = ({ avgDemand, avgTiming, avgBuildability, avgVirality, momentum, evidenceCount }) =>
  clamp(
    avgDemand * 0.20 +
    avgTiming * 0.15 +
    avgBuildability * 0.10 +
    avgVirality * 0.25 +
    momentum * 0.15 +
    clamp(evidenceCount * 12) * 0.15
  );
```

**Step 3: Update postgres_thesis_store SQL**

In `postgres_thesis_store.ts`, rename `avg_pain` → `avg_demand` and add `avg_virality` in all SQL queries (list, getByKey, listPaginated, upsert). Update `ThesisRow` type and `rowToDraft` mapping.

**Step 4: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run`
Expected: All pass

**Step 5: Commit**

```bash
git add apps/api/src/jobs/thesis_synthesizer.ts apps/api/src/runtime/postgres_thesis_store.ts
git commit -m "feat: update thesis types — avgPain→avgDemand, add avgVirality"
```

---

### Task 13: Update remaining references and run full suite

**Files:**
- Modify: any remaining files that reference `pain` in scoring context
- Check: `apps/web/src/App.tsx`, `apps/web/src/api.ts`, `apps/api/src/runtime/signal_quality.ts`

**Step 1: Search for remaining `pain` references in scoring context**

```bash
grep -rn "\.pain\b\|pain:" --include="*.ts" --include="*.tsx" apps/ packages/ | grep -v node_modules | grep -v ".test." | grep -v "pain point\|pain marker\|painMarker"
```

Fix any remaining references — rename to `demand` where it refers to the score dimension.

Note: `signal_quality.ts` has `painMarkers` — these are text analysis markers and should NOT be renamed. They check for "pain point", "customers struggle" etc. in signal text — that's about demand detection, not the score field name.

**Step 2: Update `AgentSignalSummary` type**

In `research_agent.ts`, rename `pain` → `demand` in `AgentSignalSummary`:

```typescript
export type AgentSignalSummary = {
  signal_id: string;
  text: string;
  source: string;
  demand: number;     // was: pain
  timing: number;
  virality?: number;  // NEW
};
```

**Step 3: Run full test suite**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run`
Expected: All 195+ tests pass

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: complete pain→demand rename across codebase"
```

---

### Task 14: Push PR 1

**Step 1: Create branch and push**

```bash
cd /Users/vladimirtrifonov/src/ai/idea.ai
git checkout -b feature/scoring-overhaul
git push -u origin feature/scoring-overhaul
```

**Step 2: Create PR**

```bash
gh pr create --title "feat: 4-dimension scoring with demand/virality" --body "$(cat <<'EOF'
## Summary
- Rename pain→demand across DB, types, pipeline, UI
- Add virality as 4th scoring dimension (35% weight)
- New blend formula: demand 25%, timing 20%, buildability 20%, virality 35%
- Update AI post-scrape prompt for viral/social product detection
- Broaden AI judge prompt from solo-founder SaaS to general product
- DB migration: rename column, add virality column

## Test plan
- [x] All tests pass
- [x] Backward compatible with existing signals (demand = old pain scores)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" --base dev
```

**Step 3: Merge PR**

```bash
gh pr merge --squash --delete-branch
git checkout dev && git pull
```

---

## PR 2: New Connectors

---

### Task 15: Expand Reddit default subreddits

**Files:**
- Modify: `packages/connectors/src/reddit.ts` — update `DEFAULT_SUBREDDITS`
- Modify: `apps/api/src/config/env.ts` — update default for `REDDIT_SUBREDDITS`
- Modify: `apps/api/src/runtime/live_read_model.ts` — thread env subreddits to `fetchReddit`

**Step 1: Update DEFAULT_SUBREDDITS in reddit.ts**

```typescript
export const DEFAULT_SUBREDDITS = [
  'SaaS', 'startups', 'smallbusiness', 'Entrepreneur',
  'apps', 'socialmedia', 'productivity', 'dating',
  'sideproject', 'AppIdeas', 'InternetIsBeautiful'
];
```

**Step 2: Update env.ts default**

In `apps/api/src/config/env.ts`, update the fallback array for `redditSubreddits`:

```typescript
redditSubreddits: parseCsv(env.REDDIT_SUBREDDITS, [
  'SaaS', 'startups', 'smallbusiness', 'Entrepreneur',
  'apps', 'socialmedia', 'productivity', 'dating',
  'sideproject', 'AppIdeas', 'InternetIsBeautiful'
]),
```

**Step 3: Thread env subreddits to fetchReddit**

In `ingest_open.ts`, update the reddit loader to pass subreddits from env:

```typescript
reddit: () => fetchReddit({ subreddits: env.redditSubreddits }),
```

This requires threading `env` into the loader registry. If `env` is not available at the loader creation site, pass it as a parameter.

**Step 4: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run packages/connectors/tests/reddit.test.ts`
Expected: All pass

**Step 5: Commit**

```bash
git add packages/connectors/src/reddit.ts apps/api/src/config/env.ts apps/api/src/runtime/live_read_model.ts
git commit -m "feat: expand Reddit to consumer subreddits (apps, socialmedia, productivity, etc.)"
```

---

### Task 16: Create App Store trending connector

**Files:**
- Create: `packages/connectors/src/appstore.ts`
- Create: `packages/connectors/tests/appstore.test.ts`

**Step 1: Create the connector**

```typescript
import { fetchJsonWithRetry, type RawEventInput } from './common/http';

type ItunesEntry = {
  'im:name': { label: string };
  id: { attributes: { 'im:id': string } };
  summary: { label: string };
  link: { attributes: { href: string } }[];
  'im:releaseDate': { label: string };
  category: { attributes: { label: string } };
};

type ItunesFeed = {
  feed: { entry?: ItunesEntry[] };
};

const ITUNES_CATEGORIES = ['social-networking', 'productivity', 'lifestyle', 'entertainment', 'communication'];

export const fetchAppStoreTrending = async (options?: {
  categories?: string[];
  limit?: number;
  fetchImpl?: typeof fetch;
}): Promise<RawEventInput[]> => {
  const categories = options?.categories ?? ITUNES_CATEGORIES;
  const limit = options?.limit ?? 30;
  const results: RawEventInput[] = [];

  for (const category of categories) {
    try {
      const data = await fetchJsonWithRetry<ItunesFeed>(
        `https://itunes.apple.com/us/rss/topfreeapplications/limit=10/genre=${category}/json`,
        { ...(options?.fetchImpl !== undefined && { fetchImpl: options.fetchImpl }) }
      );

      for (const entry of data.feed.entry ?? []) {
        results.push({
          source: 'appstore_trending',
          source_item_id: `appstore:${entry.id.attributes['im:id']}`,
          source_timestamp: entry['im:releaseDate']?.label ?? new Date().toISOString(),
          text: `${entry['im:name'].label}\n${entry.summary.label}`.slice(0, 2000),
          url: entry.link?.[0]?.attributes?.href ?? ''
        });
      }
    } catch {
      // Skip failed category, don't crash entire connector
    }
  }

  return results.slice(0, limit);
};
```

**Step 2: Write test**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { fetchAppStoreTrending } from '../src/appstore';

describe('appstore connector', () => {
  it('fetches and maps iTunes RSS entries to RawEventInput', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({
        feed: {
          entry: [{
            'im:name': { label: 'Cool App' },
            id: { attributes: { 'im:id': '12345' } },
            summary: { label: 'A cool social app' },
            link: [{ attributes: { href: 'https://apps.apple.com/app/12345' } }],
            'im:releaseDate': { label: '2026-03-01T00:00:00Z' },
            category: { attributes: { label: 'Social Networking' } }
          }]
        }
      }), { status: 200 }))
    );

    const events = await fetchAppStoreTrending({ categories: ['social-networking'], fetchImpl: mockFetch });

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('appstore_trending');
    expect(events[0].source_item_id).toBe('appstore:12345');
    expect(events[0].text).toContain('Cool App');
  });
});
```

**Step 3: Run test**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run packages/connectors/tests/appstore.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/connectors/src/appstore.ts packages/connectors/tests/appstore.test.ts
git commit -m "feat: add App Store trending connector (iTunes RSS)"
```

---

### Task 17: Create IndieHackers connector

**Files:**
- Create: `packages/connectors/src/indiehackers.ts`
- Create: `packages/connectors/tests/indiehackers.test.ts`

**Step 1: Create the connector**

IndieHackers doesn't have a public API but has an RSS feed at `https://www.indiehackers.com/feed.xml`. We'll parse the XML as text.

```typescript
import { type RawEventInput, withRetry } from './common/http';

type IndieHackersLoaderFn = (limit: number) => Promise<RawEventInput[]>;

const defaultLoader: IndieHackersLoaderFn = async (limit) => {
  const response = await withRetry(async () => {
    const res = await fetch('https://www.indiehackers.com/feed.xml', {
      headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' }
    });
    if (!res.ok) throw new Error(`IndieHackers feed failed: ${res.status}`);
    return res.text();
  });

  const results: RawEventInput[] = [];
  // Simple regex XML parsing — IH feed has <item><title>...<link>...<description>...<pubDate>...
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(response)) !== null && results.length < limit) {
    const item = match[1];
    const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ?? item.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] ?? '';
    const description = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1] ?? item.match(/<description>(.*?)<\/description>/)?.[1] ?? '';
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? '';

    if (title) {
      results.push({
        source: 'indiehackers',
        source_item_id: `ih:${link || title}`,
        source_timestamp: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        text: `${title}\n${description.replace(/<[^>]*>/g, '')}`.slice(0, 2000),
        url: link
      });
    }
  }

  return results;
};

export const fetchIndieHackersEvents = async (
  loadEvents: IndieHackersLoaderFn = defaultLoader,
  limit = 20
): Promise<RawEventInput[]> => {
  const events = await withRetry(() => loadEvents(limit));
  return events.slice(0, limit);
};
```

**Step 2: Write test**

```typescript
import { describe, expect, it } from 'vitest';
import { fetchIndieHackersEvents } from '../src/indiehackers';

describe('indiehackers connector', () => {
  it('maps RSS items to RawEventInput', async () => {
    const mockLoader = async () => [{
      source: 'indiehackers',
      source_item_id: 'ih:https://www.indiehackers.com/post/test',
      source_timestamp: '2026-03-01T00:00:00.000Z',
      text: 'Building a viral app\nHow I got to 10k users',
      url: 'https://www.indiehackers.com/post/test'
    }];

    const events = await fetchIndieHackersEvents(mockLoader, 20);

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('indiehackers');
    expect(events[0].text).toContain('Building a viral app');
  });

  it('respects limit', async () => {
    const mockLoader = async () => Array.from({ length: 50 }, (_, i) => ({
      source: 'indiehackers',
      source_item_id: `ih:${i}`,
      source_timestamp: new Date().toISOString(),
      text: `Post ${i}`,
      url: `https://www.indiehackers.com/post/${i}`
    }));

    const events = await fetchIndieHackersEvents(mockLoader, 5);
    expect(events).toHaveLength(5);
  });
});
```

**Step 3: Run test**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run packages/connectors/tests/indiehackers.test.ts`
Expected: All PASS

**Step 4: Commit**

```bash
git add packages/connectors/src/indiehackers.ts packages/connectors/tests/indiehackers.test.ts
git commit -m "feat: add IndieHackers connector (RSS feed)"
```

---

### Task 18: Create Twitter/X BYO connector

**Files:**
- Create: `packages/connectors/src/twitter_byo.ts`
- Create: `packages/connectors/tests/twitter-byo.test.ts`

**Step 1: Create the connector**

Follow the same BYO guard pattern as `exa_byo.ts`:

```typescript
import { type ByoConnectorResult, evaluateByoGuard } from './byo_guard';
import { fetchJsonWithRetry, type RawEventInput } from './common/http';

type Tweet = {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: { retweet_count: number; like_count: number; reply_count: number };
};

type TwitterSearchResponse = {
  data?: Tweet[];
};

const VIRAL_QUERIES = [
  '"someone should build" OR "wish there was an app" OR "I would pay for"',
  '"need an app" OR "startup idea" OR "build this"'
];

const defaultTwitterLoader = async (apiKey: string): Promise<RawEventInput[]> => {
  const results: RawEventInput[] = [];

  for (const query of VIRAL_QUERIES) {
    try {
      const response = await fetchJsonWithRetry<TwitterSearchResponse>(
        `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10&tweet.fields=created_at,public_metrics`,
        {
          init: {
            headers: { Authorization: `Bearer ${apiKey}` }
          }
        }
      );

      for (const tweet of response.data ?? []) {
        results.push({
          source: 'twitter_trending',
          source_item_id: `twitter:${tweet.id}`,
          source_timestamp: tweet.created_at ?? new Date().toISOString(),
          text: tweet.text,
          url: `https://x.com/i/status/${tweet.id}`
        });
      }
    } catch {
      // Skip failed query, continue with next
    }
  }

  return results;
};

export const runTwitterByoConnector = async (
  env: NodeJS.ProcessEnv = process.env,
  loadEvents: (apiKey: string) => Promise<RawEventInput[]> = defaultTwitterLoader
): Promise<ByoConnectorResult> => {
  const guard = evaluateByoGuard({
    connector: 'twitter_byo',
    ...(env.X_BEARER_TOKEN !== undefined && { apiKey: env.X_BEARER_TOKEN }),
    ...(env.X_DAILY_BUDGET_USD !== undefined && { budgetValue: env.X_DAILY_BUDGET_USD }),
    fallbackBudget: 0 // Default budget 0 = disabled unless explicitly configured
  });

  if (!guard.allowed) {
    return {
      status: 'skipped',
      reason: guard.reason,
      events: [],
      telemetry: guard.telemetry
    };
  }

  const events = await loadEvents(env.X_BEARER_TOKEN as string);

  return {
    status: 'active',
    events,
    telemetry: {
      connector: 'twitter_byo',
      skipped: false,
      budget_usd: guard.budgetUsd
    }
  };
};
```

**Step 2: Write test**

```typescript
import { describe, expect, it } from 'vitest';
import { runTwitterByoConnector } from '../src/twitter_byo';

describe('twitter BYO connector', () => {
  it('skips when X_BEARER_TOKEN is missing', async () => {
    const result = await runTwitterByoConnector({});
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('missing_credentials');
    expect(result.events).toHaveLength(0);
  });

  it('returns events when token is provided', async () => {
    const mockLoader = async () => [{
      source: 'twitter_trending',
      source_item_id: 'twitter:123',
      source_timestamp: '2026-03-01T00:00:00Z',
      text: 'someone should build an app for this',
      url: 'https://x.com/i/status/123'
    }];

    const result = await runTwitterByoConnector(
      { X_BEARER_TOKEN: 'test-token', X_DAILY_BUDGET_USD: '10' },
      mockLoader
    );

    expect(result.status).toBe('active');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].source).toBe('twitter_trending');
  });
});
```

**Step 3: Run test**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run packages/connectors/tests/twitter-byo.test.ts`
Expected: All PASS

**Step 4: Commit**

```bash
git add packages/connectors/src/twitter_byo.ts packages/connectors/tests/twitter-byo.test.ts
git commit -m "feat: add Twitter/X BYO connector"
```

---

### Task 19: Create TikTok BYO connector

**Files:**
- Create: `packages/connectors/src/tiktok_byo.ts`
- Create: `packages/connectors/tests/tiktok-byo.test.ts`

**Step 1: Create the connector**

Same BYO pattern. TikTok Research API requires approval, so this is gated on `TIKTOK_API_KEY`:

```typescript
import { type ByoConnectorResult, evaluateByoGuard } from './byo_guard';
import { fetchJsonWithRetry, type RawEventInput } from './common/http';

type TikTokVideo = {
  id: string;
  desc: string;
  createTime: number;
  stats?: { diggCount: number; shareCount: number; commentCount: number };
};

type TikTokSearchResponse = {
  data?: { videos?: TikTokVideo[] };
};

const defaultTikTokLoader = async (apiKey: string): Promise<RawEventInput[]> => {
  try {
    const response = await fetchJsonWithRetry<TikTokSearchResponse>(
      'https://open.tiktokapis.com/v2/research/video/query/',
      {
        init: {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            query: { and: [{ field_name: 'keyword', field_values: ['app idea', 'startup', 'build an app'] }] },
            max_count: 20,
            start_date: new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10),
            end_date: new Date().toISOString().slice(0, 10)
          })
        }
      }
    );

    return (response.data?.videos ?? []).map((video) => ({
      source: 'tiktok_trending',
      source_item_id: `tiktok:${video.id}`,
      source_timestamp: new Date(video.createTime * 1000).toISOString(),
      text: video.desc.slice(0, 2000),
      url: `https://www.tiktok.com/video/${video.id}`
    }));
  } catch {
    return [];
  }
};

export const runTikTokByoConnector = async (
  env: NodeJS.ProcessEnv = process.env,
  loadEvents: (apiKey: string) => Promise<RawEventInput[]> = defaultTikTokLoader
): Promise<ByoConnectorResult> => {
  const guard = evaluateByoGuard({
    connector: 'tiktok_byo',
    ...(env.TIKTOK_API_KEY !== undefined && { apiKey: env.TIKTOK_API_KEY }),
    ...(env.TIKTOK_DAILY_BUDGET_USD !== undefined && { budgetValue: env.TIKTOK_DAILY_BUDGET_USD }),
    fallbackBudget: 0
  });

  if (!guard.allowed) {
    return { status: 'skipped', reason: guard.reason, events: [], telemetry: guard.telemetry };
  }

  const events = await loadEvents(env.TIKTOK_API_KEY as string);

  return {
    status: 'active',
    events,
    telemetry: { connector: 'tiktok_byo', skipped: false, budget_usd: guard.budgetUsd }
  };
};
```

**Step 2: Write test (same pattern as twitter)**

```typescript
import { describe, expect, it } from 'vitest';
import { runTikTokByoConnector } from '../src/tiktok_byo';

describe('tiktok BYO connector', () => {
  it('skips when TIKTOK_API_KEY is missing', async () => {
    const result = await runTikTokByoConnector({});
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('missing_credentials');
  });

  it('returns events when key is provided', async () => {
    const mockLoader = async () => [{
      source: 'tiktok_trending',
      source_item_id: 'tiktok:456',
      source_timestamp: '2026-03-01T00:00:00Z',
      text: 'this app idea went viral',
      url: 'https://www.tiktok.com/video/456'
    }];

    const result = await runTikTokByoConnector(
      { TIKTOK_API_KEY: 'test-key', TIKTOK_DAILY_BUDGET_USD: '5' },
      mockLoader
    );

    expect(result.status).toBe('active');
    expect(result.events).toHaveLength(1);
  });
});
```

**Step 3: Run test**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run packages/connectors/tests/tiktok-byo.test.ts`
Expected: All PASS

**Step 4: Commit**

```bash
git add packages/connectors/src/tiktok_byo.ts packages/connectors/tests/tiktok-byo.test.ts
git commit -m "feat: add TikTok BYO connector"
```

---

### Task 20: Register new connectors in the system

**Files:**
- Modify: `packages/connectors/src/common/http.ts` — add limits/cadence for new open connectors
- Modify: `apps/api/src/config/env.ts` — add new BYO env vars
- Modify: `apps/api/src/runtime/live_read_model.ts` — add new connectors to OPEN_CONNECTORS, OpenConnectorName
- Modify: `apps/api/src/jobs/ingest_open.ts` — register appstore and indiehackers loaders
- Modify: `apps/api/src/jobs/ingest_byo.ts` — register twitter and tiktok BYO connectors

**Step 1: Update OPEN_CONNECTOR_LIMITS and CADENCE in http.ts**

Add:
```typescript
appstore_trending: 30,
indiehackers: 20,
```

Add cadence:
```typescript
appstore_trending: 'daily',
indiehackers: 'daily',
```

**Step 2: Update env.ts**

Add new BYO env vars to `RuntimeEnv` type and `loadRuntimeEnv`:
```typescript
xBearerToken?: string;
xDailyBudgetUsd: number;
tiktokApiKey?: string;
tiktokDailyBudgetUsd: number;
enableJobConnectors: boolean;
```

With parsing:
```typescript
xDailyBudgetUsd: parseNumber(env.X_DAILY_BUDGET_USD, 0),
tiktokDailyBudgetUsd: parseNumber(env.TIKTOK_DAILY_BUDGET_USD, 0),
enableJobConnectors: env.ENABLE_JOB_CONNECTORS === 'true',
```

**Step 3: Update OPEN_CONNECTORS and OpenConnectorName**

In `ingest_open.ts`:
```typescript
export type OpenConnectorName = 'hn' | 'github_issues' | 'greenhouse' | 'lever' | 'yc_companies' | 'reddit' | 'producthunt' | 'appstore_trending' | 'indiehackers';
```

In `live_read_model.ts`:
```typescript
const OPEN_CONNECTORS: OpenConnectorName[] = ['hn', 'github_issues', 'greenhouse', 'lever', 'yc_companies', 'reddit', 'producthunt', 'appstore_trending', 'indiehackers'];
```

**Step 4: Register loaders in ingest_open.ts**

Add imports and default loaders:
```typescript
import { fetchAppStoreTrending } from '@idea/connectors/src/appstore';
import { fetchIndieHackersEvents } from '@idea/connectors/src/indiehackers';

// In defaultLoaders:
appstore_trending: () => fetchAppStoreTrending(),
indiehackers: () => fetchIndieHackersEvents(),
```

**Step 5: Register BYO connectors in ingest_byo.ts**

Add twitter and tiktok alongside exa and perigon:
```typescript
import { runTwitterByoConnector } from '@idea/connectors/src/twitter_byo';
import { runTikTokByoConnector } from '@idea/connectors/src/tiktok_byo';

// In the Promise.all:
runSafely('twitter_byo', env, runTwitterByoConnector, logger),
runSafely('tiktok_byo', env, runTikTokByoConnector, logger)
```

**Step 6: Make job connectors opt-in**

In the cadence routing or `isConnectorConfigured`, gate greenhouse/lever on `env.enableJobConnectors`:
```typescript
if ((connector === 'greenhouse' || connector === 'lever') && !env.enableJobConnectors) {
  return false;
}
```

**Step 7: Run full test suite**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run`
Expected: All pass

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: register new connectors — appstore, indiehackers, twitter BYO, tiktok BYO"
```

---

### Task 21: Push PR 2

**Step 1: Create branch and push**

```bash
cd /Users/vladimirtrifonov/src/ai/idea.ai
git checkout -b feature/new-connectors
git push -u origin feature/new-connectors
```

**Step 2: Create PR**

```bash
gh pr create --title "feat: add new signal connectors for viral/social discovery" --body "$(cat <<'EOF'
## Summary
- Expand Reddit to 11 subreddits (add apps, socialmedia, productivity, dating, sideproject, AppIdeas, InternetIsBeautiful)
- Add App Store trending connector (iTunes RSS, daily cadence)
- Add IndieHackers connector (RSS feed, daily cadence)
- Add Twitter/X BYO connector (X API v2, gated on X_BEARER_TOKEN)
- Add TikTok BYO connector (Research API, gated on TIKTOK_API_KEY)
- Make job board connectors (greenhouse, lever) opt-in via ENABLE_JOB_CONNECTORS=true

## Test plan
- [x] All tests pass including new connector tests
- [x] BYO connectors skip gracefully without API keys

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" --base dev
```

**Step 3: Merge PR**

```bash
gh pr merge --squash --delete-branch
git checkout dev && git pull
```

---

## PR 3: Agent Intelligence

---

### Task 22: Update research agent broad scan prompt

**Files:**
- Modify: `apps/api/src/jobs/research_agent.ts`

**Step 1: Update buildBroadScanPrompt**

In `research_agent.ts`, update the broad scan prompt (lines 113-177):

1. Replace the opening persona:
```
You are Sixth Sense, a product opportunity scout with persistent memory.
You analyze market signals to find product ideas with viral growth potential — consumer social apps, prosumer tools with network effects, B2B products that spread bottom-up, and community-driven platforms.
```

2. Remove the solo-dev constraint. Replace:
```
- The product must be buildable by a solo dev in 1-3 months — no enterprise platforms, no consulting frameworks, no marketplace plays
```
with:
```
- Focus on ideas with inherent viral/network-effect potential — products where users naturally bring other users
- Assess growth loop mechanics: does usage create shareable content? Does the product get better with more users?
```

3. Update GOOD/BAD examples:
```
- BAD examples: "Vertical SaaS Consolidation in Regulated Industries", "Proxy-signal instrumentation"
- GOOD examples: "Community Recipe Sharing App with AI Meal Planning", "TikTok-Style Short Video Editor for Realtors", "Slack Bot That Summarizes Long Threads"
```

4. Update the signal display format — `pain:` → `demand:`, add virality if available:
```typescript
`    - [${s.signal_id}] [${s.source}] ${s.text.slice(0, 200)} (demand: ${s.demand}, timing: ${s.timing}${s.virality != null ? `, virality: ${s.virality}` : ''})`
```

5. Add virality assessment to the task:
```
5. For each thesis update or new idea, assess virality potential — does it have inherent network effects, sharing mechanics, or community-driven growth loops?
```

**Step 2: Commit**

```bash
git add apps/api/src/jobs/research_agent.ts
git commit -m "feat: update broad scan prompt for viral/social opportunity detection"
```

---

### Task 23: Update research agent deep dive prompt

**Files:**
- Modify: `apps/api/src/jobs/research_agent.ts`

**Step 1: Update buildDeepDivePrompt**

1. Remove solo-dev constraint from GUIDELINES. Replace with virality focus:
```
- Assess virality and network effects — how would users discover and share this product?
- Consider growth loops: does the product create shareable artifacts? Does value increase with users?
- Products with inherent distribution (social, community, UGC) are higher signal
```

2. Update the signal display format — `pain:` → `demand:`, add virality.

3. Update the DEEP ANALYSIS section:
```
1. What product ideas emerge from these signals? Prioritize ideas with viral distribution mechanics.
2. How has this area evolved? Compare current vs historical signals for momentum.
3. Assess growth loop potential for each idea — organic distribution, network effects, community flywheel.
4. Write detailed observations for your future self — what viral angles did you explore?
```

**Step 2: Commit**

```bash
git add apps/api/src/jobs/research_agent.ts
git commit -m "feat: update deep dive prompt for virality and growth loop analysis"
```

---

### Task 24: Update NewThesisProposal type — add virality_assessment

**Files:**
- Modify: `apps/api/src/jobs/research_agent.ts`

**Step 1: Add virality_assessment to NewThesisProposal**

```typescript
export type NewThesisProposal = {
  title: string;
  problem_statement: string;
  target_buyer: string;
  proposed_solution: string;
  supporting_signal_ids: string[];
  estimated_scope: 'small' | 'medium' | 'large';
  virality_assessment?: string;  // NEW: 1-2 sentence growth loop description
};
```

**Step 2: Update the JSON output schema in both prompts**

Add `"virality_assessment": "..."` to the `new_theses` array in the prompt JSON examples for both broad scan and deep dive.

**Step 3: Update AgentSignalSummary**

Rename `pain` → `demand`, add `virality`:

```typescript
export type AgentSignalSummary = {
  signal_id: string;
  text: string;
  source: string;
  demand: number;
  timing: number;
  virality?: number;
};
```

**Step 4: Update agent_runner.ts context loading**

In `agent_runner.ts`, where signals are mapped to `AgentSignalSummary`, rename `pain:` → `demand:` and add `virality:`.

**Step 5: Run tests**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run`
Expected: All pass

**Step 6: Commit**

```bash
git add apps/api/src/jobs/research_agent.ts apps/api/src/jobs/agent_runner.ts
git commit -m "feat: add virality_assessment to thesis proposals, update signal types"
```

---

### Task 25: Update thesis confidence formula to include virality

**Files:**
- Modify: `apps/api/src/jobs/thesis_synthesizer.ts`

**Step 1: Update buildConfidence**

Already done in Task 12 (part of PR1). Verify the formula includes `avgVirality * 0.25`.

If not yet applied, update:
```typescript
const buildConfidence = ({ avgDemand, avgTiming, avgBuildability, avgVirality, momentum, evidenceCount }) =>
  clamp(
    avgDemand * 0.20 +
    avgTiming * 0.15 +
    avgBuildability * 0.10 +
    avgVirality * 0.25 +
    momentum * 0.15 +
    clamp(evidenceCount * 12) * 0.15
  );
```

**Step 2: Run full test suite**

Run: `cd /Users/vladimirtrifonov/src/ai/idea.ai && CI=1 pnpm exec vitest run`
Expected: All pass. Count should be ~200+ tests.

**Step 3: Commit**

```bash
git add apps/api/src/jobs/thesis_synthesizer.ts
git commit -m "feat: include virality in thesis confidence formula"
```

---

### Task 26: Push PR 3

**Step 1: Create branch and push**

```bash
cd /Users/vladimirtrifonov/src/ai/idea.ai
git checkout -b feature/agent-virality-intelligence
git push -u origin feature/agent-virality-intelligence
```

**Step 2: Create PR**

```bash
gh pr create --title "feat: update research agent for viral/social opportunity detection" --body "$(cat <<'EOF'
## Summary
- Update broad scan prompt: remove solo-dev constraint, add virality assessment
- Update deep dive prompt: prioritize growth loops and network effects
- Add virality_assessment field to NewThesisProposal
- Rename pain→demand in AgentSignalSummary
- Include virality in thesis confidence formula

## Test plan
- [x] All tests pass
- [x] Agent prompts focus on viral/social/network-effect opportunities

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" --base dev
```

**Step 3: Merge PR**

```bash
gh pr merge --squash --delete-branch
git checkout dev && git pull
```

---

## Verification Checklist

After all 3 PRs are merged:

1. `pnpm exec vitest run` — all tests pass (should be ~200+)
2. Apply migration `0012_demand_virality.sql` to database
3. Start server, trigger agent run — verify:
   - AI post-scrape output includes `demand` and `virality` scores (not `pain`)
   - Breakdown chips show "Demand" and "Viral" in UI
   - Reddit connector fetches from expanded subreddit list
   - BYO connectors (twitter, tiktok) skip gracefully without API keys
   - Job board connectors are disabled by default
   - Research agent prompt mentions viral/network effects (check logs)
4. If `X_BEARER_TOKEN` is configured, verify Twitter signals appear
5. Verify blended score formula: `demand*0.25 + timing*0.20 + buildability*0.20 + virality*0.35`
