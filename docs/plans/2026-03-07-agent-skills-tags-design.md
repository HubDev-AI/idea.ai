# Agent Skills & Tags System — Design

**Goal:** Add a file-based agent skill plugin system and multi-dimensional thesis tagging, creating a feedback loop where skills produce tags and tags guide which skills activate.

**Constraints:** Design-only document. No implementation in this session.

**References:**
- [pm-skills](https://github.com/phuryn/pm-skills) — Plugin architecture inspiration (65 skills, 8 plugins, manifest-based)
- [open-seo](https://github.com/every-app/open-seo) — Future connector for SEO keyword data

---

## 1. Agent Skill Plugin System

### Structure

```
packages/agent-skills/
  src/
    loader.ts              # Discovers and loads skill manifests at startup
    types.ts               # SkillManifest, SkillContext, SkillResult types
    skills/
      market-categorizer/
        manifest.json      # metadata, triggers, I/O schema
        prompt.md           # prompt template with {{variables}}
      seo-keyword-tagger/
        manifest.json
        prompt.md
      competitor-scanner/
        manifest.json
        prompt.md
      validation-checker/
        manifest.json
        prompt.md
```

### Manifest Schema

```typescript
type SkillManifest = {
  id: string;                          // "market-categorizer"
  name: string;                        // "Market Categorizer"
  description: string;
  version: string;
  tier: 'cheap' | 'medium' | 'expensive';  // maps to model router
  trigger: {
    phase: 'post-scan' | 'post-debate' | 'post-enrichment' | 'on-demand';
    when?: {                           // optional conditions
      minConfidence?: number;
      missingTags?: string[];          // run if thesis lacks these tag types
      hasTags?: string[];              // run if thesis has these tag types
      hasStatus?: string[];
    };
  };
  input: {                             // what context the skill needs
    thesis: boolean;
    signals?: boolean;
    existingTags?: boolean;
    journal?: boolean;
  };
  output: {
    tags: { type: string; }[];         // tag types this skill produces
    updatesThesis?: boolean;           // can modify thesis fields
    journalEntry?: boolean;            // can write journal entries
  };
};
```

### Execution Flow

1. Agent runner completes its existing phases (broad scan -> debate -> deep dive -> enrichment)
2. New **Phase 4: Skill Execution** — loader provides skills matching current phase
3. For each thesis, check skill trigger conditions against thesis state + existing tags
4. Run matching skills (cheap skills via Ollama router, expensive via CLI)
5. Parse skill output, write tags + any thesis updates

### Key Decisions

- Skills are **file-based**, not DB-stored — version-controlled, reviewable, deployable
- Skill prompts use **template variables** (`{{thesis.title}}`, `{{signals}}`, etc.) filled by the runner
- Skills declare their **model tier** — router handles cheap/medium/expensive routing
- Skills are **profile-agnostic** by default — profiles select which skills to activate

---

## 2. Tag System

### Database

New table `thesis_tags`:

```sql
CREATE TABLE thesis_tags (
  id SERIAL PRIMARY KEY,
  canonical_key TEXT NOT NULL REFERENCES thesis_candidates(canonical_key),
  tag_type TEXT NOT NULL,        -- 'category', 'seo', 'operational'
  tag_value TEXT NOT NULL,       -- 'fintech', 'invoice automation software', 'has-competitor'
  source TEXT NOT NULL,          -- 'skill:market-categorizer', 'connector:open-seo', 'user'
  confidence REAL,               -- 0-1, how confident the source is (null for user tags)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(canonical_key, tag_type, tag_value)
);

CREATE INDEX idx_thesis_tags_key ON thesis_tags(canonical_key);
CREATE INDEX idx_thesis_tags_type_value ON thesis_tags(tag_type, tag_value);
```

### Tag Types

| Type | Example Values | Sources |
|------|---------------|---------|
| `category` | fintech, dev-tools, creator-economy, health-tech | skill:market-categorizer, user |
| `seo` | "ai code review tool", "invoice automation" | skill:seo-keyword-tagger, connector:open-seo |
| `operational` | has-competitor, api-first, needs-validation, monetizable | skill:competitor-scanner, skill:validation-checker |

### API

- `GET /v1/theses/:key/tags` — all tags for a thesis
- `POST /v1/theses/:key/tags` — add user tag `{ type, value }`
- `DELETE /v1/theses/:key/tags/:id` — remove a tag
- `GET /v1/theses?tag=category:fintech` — filter theses by tag
- `GET /v1/tags?type=category` — list all unique tags of a type (for autocomplete)

### Frontend

- Tags rendered as color-coded pills below each thesis card (by tag type)
- Filter dropdown in pane header alongside existing label/sort filters
- Tag autocomplete using `GET /v1/tags` endpoint

---

## 3. Open-SEO Connector

### Integration Pattern

Open-SEO becomes a new **daily BYO connector** (like exa_byo, perigon_byo) — disabled by default, activated when the user provides credentials.

### Configuration

- `OPEN_SEO_BASE_URL` — self-hosted open-seo instance URL
- `OPEN_SEO_API_KEY` — API key for authentication

### Flow

1. Each daily refresh, connector queries open-seo for keyword data relevant to existing thesis topics
2. Results arrive as signals with source `open_seo`, containing: keyword, search_volume, difficulty, cpc, trend
3. The `seo-keyword-tagger` skill picks up these signals during Phase 4 and writes `seo` tags to matching theses

### What It Provides

- **Demand validation** — search volume confirms people actually search for what a thesis proposes
- **Competition signal** — keyword difficulty shows how contested the space is
- **Monetization hint** — CPC indicates commercial intent

---

## 4. The Feedback Loop (Skills <-> Tags)

### Tags -> Skills

Skill triggers reference tags:

```json
{
  "trigger": {
    "phase": "post-scan",
    "when": {
      "missingTags": ["category"],
      "minConfidence": 20
    }
  }
}
```

The market-categorizer only runs on theses that don't have a `category` tag yet. The competitor-scanner only runs on theses tagged `category:*` (needs the market context). Natural dependency chains without explicit ordering.

### Skills -> Tags

Each skill declares what tag types it produces. The runner collects output, deduplicates against existing tags (UNIQUE constraint), and upserts. Confidence scores allow skills to override low-confidence tags from earlier runs.

### Connector -> Skills -> Tags

Open-SEO signals feed into the pipeline like any other connector. The seo-keyword-tagger skill matches keyword signals to theses by topic similarity, writes `seo` tags. Other skills trigger on `hasTags: ["seo"]` — e.g., a monetization-scorer that only runs when CPC data exists.

### Cycle

```
Connectors (open-seo, etc.)
    | signals
Agent Phases 1-3 (broad scan, debate, deep dive, enrichment)
    | theses with confidence/status
Phase 4: Skill Execution
    | checks triggers (missing tags? has tags? confidence?)
    | runs matching skills
    | writes tags
    | next cycle: new tags change which skills trigger
```

---

## Files Touched (Implementation Scope)

| Area | Files | Change |
|------|-------|--------|
| New package | `packages/agent-skills/` | Skill loader, types, manifest schema |
| Skills | `packages/agent-skills/src/skills/*/` | 4 initial skills (categorizer, seo-tagger, competitor, validation) |
| Database | `apps/api/src/migrations/` | New `thesis_tags` table |
| Agent runner | `apps/api/src/jobs/agent_runner.ts` | Phase 4: skill execution after enrichment |
| API routes | `apps/api/src/routes/` | Tag CRUD endpoints |
| Contracts | `packages/contracts/src/api.ts` | Tag types in API contract |
| Frontend | `apps/web/src/components/ThesisCard.tsx` | Tag pills display |
| Frontend | `apps/web/src/components/` | Tag filter UI |
| Connector | `packages/connectors/src/open_seo.ts` | Open-SEO BYO connector |
| Config | `apps/api/src/config/env.ts` | Open-SEO env vars |
