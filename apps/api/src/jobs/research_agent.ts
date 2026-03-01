// === Existing types (keep as-is) ===

export type AgentThesisSummary = {
  canonicalKey: string;
  title: string;
  confidence: number;
  status: string;
  evidenceCount: number;
};

export type AgentSignalSummary = {
  signal_id: string;
  text: string;
  source: string;
  demand: number;
  timing: number;
};

export type AgentTrendSummary = {
  topic: string;
  window: string;
  count: number;
  avg_demand: number;
  growth: string;
};

export type ThesisUpdate = {
  canonicalKey: string;
  confidence_delta: number;
  reasoning: string;
};

export type NewThesisProposal = {
  title: string;
  problem_statement: string;
  target_buyer: string;
  proposed_solution: string;
  supporting_signal_ids: string[];
  estimated_scope: 'small' | 'medium' | 'large';
};

// === New types for phased execution ===

export type ClusterSummary = {
  id: number;
  label: string;
  totalCount: number;
  avgDemand: number;
  avgTiming: number;
  sources: string[];
  signals: AgentSignalSummary[];
};

export type JournalSummary = {
  entry_type: string;
  topic: string;
  insight: string;
  narrative: string | null;
  created_at: string;
};

export type BroadScanContext = {
  activeTheses: AgentThesisSummary[];
  clusters: ClusterSummary[];
  recentJournal: JournalSummary[];
  trendSummary: AgentTrendSummary[];
};

export type BroadScanOutput = {
  thesis_updates: ThesisUpdate[];
  dig_deeper: { topic: string; reason: string; related_cluster_ids: number[] }[];
  observations: {
    entry_type: string;
    topic: string;
    insight: string;
    narrative: string;
  }[];
};

export type DeepDiveContext = {
  topic: string;
  reason: string;
  currentSignals: AgentSignalSummary[];
  historicalSignals: AgentSignalSummary[];
  journalHistory: JournalSummary[];
  relatedTheses: AgentThesisSummary[];
};

export type DeepDiveOutput = {
  thesis_updates: ThesisUpdate[];
  new_theses: NewThesisProposal[];
  journal_entries: {
    entry_type: string;
    topic: string;
    insight: string;
    narrative: string;
    confidence: number;
    thesis_keys: string[];
    signal_ids: string[];
  }[];
};

// === Legacy types for backwards compatibility ===

export type AgentContext = {
  activeTheses: AgentThesisSummary[];
  recentSignals: AgentSignalSummary[];
  trendSummary: AgentTrendSummary[];
};

// === Prompt builders ===

export const buildBroadScanPrompt = (ctx: BroadScanContext): string => {
  const thesesBlock = ctx.activeTheses.length > 0
    ? ctx.activeTheses.map((t) =>
        `- "${t.title}" [${t.canonicalKey}] (confidence: ${t.confidence}%, ${t.evidenceCount} signals, status: ${t.status})`
      ).join('\n')
    : '(none yet)';

  const clustersBlock = ctx.clusters.length > 0
    ? ctx.clusters.map((c) => {
        const signals = c.signals.map((s) =>
          `    - [${s.signal_id}] [${s.source}] ${s.text.slice(0, 200)} (demand: ${s.demand}, timing: ${s.timing})`
        ).join('\n');
        return `  CLUSTER ${c.id}: "${c.label}" (${c.totalCount} signals, avg demand: ${c.avgDemand}, sources: ${c.sources.join(', ')})\n${signals}`;
      }).join('\n\n')
    : '(no new signals)';

  const journalBlock = ctx.recentJournal.length > 0
    ? ctx.recentJournal.map((j) =>
        `- [${j.entry_type}] ${j.topic}: ${j.insight}${j.narrative ? `\n  Context: ${j.narrative.slice(0, 300)}` : ''}`
      ).join('\n')
    : '(first run — no previous observations)';

  const trendsBlock = ctx.trendSummary.length > 0
    ? ctx.trendSummary.map((t) =>
        `- "${t.topic}" ${t.window}: ${t.count} signals, avg demand ${t.avg_demand}, growth ${t.growth}`
      ).join('\n')
    : '(no trend data)';

  return `You are Sixth Sense, a SaaS product idea scout with persistent memory.
You analyze market signals to find CONCRETE software product ideas that a solo developer or small team (1-3 people) could build in 1-3 months.
Your observations from previous runs are shown below — use them to build on your prior reasoning.

IMPORTANT GUIDELINES:
- Each thesis must be a CONCRETE SaaS product idea, not an abstract market observation.
- BAD examples: "Vertical SaaS Consolidation in Regulated Industries", "Proxy-signal instrumentation for compliance monitoring", "Regulated-market momentum analysis"
- GOOD examples: "SOC2 Compliance Checklist App for Startups", "AI Invoice Parser for Freelancers", "Slack Bot That Summarizes Long Threads"
- Focus on specific pain points with clear software solutions
- Target specific buyer personas (e.g., "DevOps engineers at seed-stage startups"), not abstract categories
- The product must be buildable by a solo dev in 1-3 months — no enterprise platforms, no consulting frameworks, no marketplace plays

YOUR RECENT OBSERVATIONS:
${journalBlock}

ACTIVE THESES YOU'RE TRACKING:
${thesesBlock}

NEW SIGNAL CLUSTERS (grouped by semantic similarity):
${clustersBlock}

TREND WINDOWS:
${trendsBlock}

YOUR TASK:
1. Analyze signal clusters. What concrete product ideas do they suggest? Do any clusters reinforce or contradict existing theses?
2. For each relevant thesis, provide a confidence_delta (-20 to +20) with reasoning.
3. Identify 1-3 topics that deserve deeper investigation — areas where you see specific product opportunities that need more validation.
4. Write 2-5 observations for your future self. Focus on concrete product angles and buyer pain points, not abstract market patterns.

Return ONLY valid JSON:
{
  "thesis_updates": [{"canonicalKey": "...", "confidence_delta": <n>, "reasoning": "..."}],
  "dig_deeper": [{"topic": "...", "reason": "...", "related_cluster_ids": [<n>]}],
  "observations": [{"entry_type": "trend_shift|emerging_pattern|thesis_evolution|market_signal", "topic": "...", "insight": "...", "narrative": "..."}]
}`;
};

export const buildDeepDivePrompt = (ctx: DeepDiveContext): string => {
  const currentBlock = ctx.currentSignals.map((s) =>
    `- [${s.signal_id}] [${s.source}] ${s.text.slice(0, 300)} (demand: ${s.demand}, timing: ${s.timing})`
  ).join('\n') || '(none)';

  const historicalBlock = ctx.historicalSignals.map((s) =>
    `- [${s.signal_id}] [${s.source}] ${s.text.slice(0, 300)} (demand: ${s.demand}, timing: ${s.timing})`
  ).join('\n') || '(no historical data)';

  const journalBlock = ctx.journalHistory.map((j) =>
    `- [${j.created_at}] [${j.entry_type}] ${j.insight}${j.narrative ? `\n  ${j.narrative.slice(0, 400)}` : ''}`
  ).join('\n') || '(no prior observations on this topic)';

  const thesesBlock = ctx.relatedTheses.map((t) =>
    `- "${t.title}" [${t.canonicalKey}] (confidence: ${t.confidence}%, ${t.evidenceCount} signals)`
  ).join('\n') || '(no related theses)';

  return `You are Sixth Sense, investigating: "${ctx.topic}"

REASON FOR INVESTIGATION:
${ctx.reason}

CURRENT SIGNALS ON THIS TOPIC:
${currentBlock}

HISTORICAL SIGNALS (from semantic search — may be weeks/months old):
${historicalBlock}

YOUR PAST OBSERVATIONS ON THIS TOPIC:
${journalBlock}

RELATED THESES:
${thesesBlock}

IMPORTANT GUIDELINES FOR NEW THESES:
- Each thesis must be a CONCRETE SaaS product idea that a solo developer or small team could build in 1-3 months
- BAD: "Vertical SaaS Consolidation in Regulated Industries" (too abstract, enterprise-scale)
- BAD: "Proxy-signal instrumentation platform" (meaningless buzzwords, no clear product)
- GOOD: "SOC2 Compliance Checklist App" (specific product, clear buyer, buildable)
- GOOD: "AI-Powered Contract Clause Highlighter for Freelancers" (clear pain, specific user)
- The problem_statement should describe a real pain point a specific person has
- The target_buyer should be a specific persona (e.g., "freelance designers who invoice 5+ clients/month")
- The proposed_solution should describe a concrete software tool, not a strategy or framework

DEEP ANALYSIS:
1. What concrete product ideas emerge from these signals? Look for specific pain points with software solutions.
2. How has this area evolved over time? Compare current vs historical signals.
3. Should any existing thesis be updated? Should a new thesis be created?
4. Write detailed observations for your future self — what product angles did you explore?

For estimated_scope use: "small" (solo dev, 1-2 months), "medium" (2-3 devs, 2-4 months), "large" (team of 4+, 4+ months).

Return ONLY valid JSON:
{
  "thesis_updates": [{"canonicalKey": "...", "confidence_delta": <n>, "reasoning": "..."}],
  "new_theses": [{"title": "...", "problem_statement": "...", "target_buyer": "...", "proposed_solution": "...", "supporting_signal_ids": ["..."], "estimated_scope": "small|medium|large"}],
  "journal_entries": [{"entry_type": "trend_shift|emerging_pattern|thesis_evolution|market_signal", "topic": "...", "insight": "...", "narrative": "...", "confidence": <n>, "thesis_keys": ["..."], "signal_ids": ["..."]}]
}`;
};

// === Parsers ===

export const parseBroadScanResponse = (raw: string): BroadScanOutput | null => {
  try {
    const text = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(text) as BroadScanOutput;
    if (!Array.isArray(parsed.thesis_updates)) return null;
    return {
      thesis_updates: parsed.thesis_updates ?? [],
      dig_deeper: parsed.dig_deeper ?? [],
      observations: parsed.observations ?? []
    };
  } catch {
    return null;
  }
};

export const parseDeepDiveResponse = (raw: string): DeepDiveOutput | null => {
  try {
    const text = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(text) as DeepDiveOutput;
    if (!Array.isArray(parsed.thesis_updates)) return null;
    return {
      thesis_updates: parsed.thesis_updates ?? [],
      new_theses: parsed.new_theses ?? [],
      journal_entries: parsed.journal_entries ?? []
    };
  } catch {
    return null;
  }
};

