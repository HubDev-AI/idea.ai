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
  pain: number;
  timing: number;
};

export type AgentTrendSummary = {
  topic: string;
  window: string;
  count: number;
  avg_pain: number;
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
};

// === New types for phased execution ===

export type ClusterSummary = {
  id: number;
  label: string;
  totalCount: number;
  avgPain: number;
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

export type AgentOutput = {
  theses_updated: ThesisUpdate[];
  new_theses: NewThesisProposal[];
  alerts: string[];
  investigate_next: string;
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
          `    - [${s.signal_id}] [${s.source}] ${s.text.slice(0, 200)} (pain: ${s.pain}, timing: ${s.timing})`
        ).join('\n');
        return `  CLUSTER ${c.id}: "${c.label}" (${c.totalCount} signals, avg pain: ${c.avgPain}, sources: ${c.sources.join(', ')})\n${signals}`;
      }).join('\n\n')
    : '(no new signals)';

  const journalBlock = ctx.recentJournal.length > 0
    ? ctx.recentJournal.map((j) =>
        `- [${j.entry_type}] ${j.topic}: ${j.insight}${j.narrative ? `\n  Context: ${j.narrative.slice(0, 300)}` : ''}`
      ).join('\n')
    : '(first run — no previous observations)';

  const trendsBlock = ctx.trendSummary.length > 0
    ? ctx.trendSummary.map((t) =>
        `- "${t.topic}" ${t.window}: ${t.count} signals, avg pain ${t.avg_pain}, growth ${t.growth}`
      ).join('\n')
    : '(no trend data)';

  return `You are Sixth Sense, a SaaS opportunity intelligence system with persistent memory.
You analyze market signals continuously and maintain an evolving understanding of emerging opportunities.
Your observations from previous runs are shown below — use them to build on your prior reasoning.

YOUR RECENT OBSERVATIONS:
${journalBlock}

ACTIVE THESES YOU'RE TRACKING:
${thesesBlock}

NEW SIGNAL CLUSTERS (grouped by semantic similarity):
${clustersBlock}

TREND WINDOWS:
${trendsBlock}

YOUR TASK:
1. Analyze signal clusters. What patterns emerge across them? Do any clusters reinforce or contradict existing theses?
2. For each relevant thesis, provide a confidence_delta (-20 to +20) with reasoning.
3. Identify 1-3 topics that deserve deeper investigation. These should be areas where you see emerging patterns, contradictions, or high-potential signals that need more context.
4. Write 2-5 observations for your future self. Focus on patterns, shifts, and connections — not just summaries. Your future self will read these to understand what you were thinking.

Return ONLY valid JSON:
{
  "thesis_updates": [{"canonicalKey": "...", "confidence_delta": <n>, "reasoning": "..."}],
  "dig_deeper": [{"topic": "...", "reason": "...", "related_cluster_ids": [<n>]}],
  "observations": [{"entry_type": "trend_shift|emerging_pattern|thesis_evolution|market_signal", "topic": "...", "insight": "...", "narrative": "..."}]
}`;
};

export const buildDeepDivePrompt = (ctx: DeepDiveContext): string => {
  const currentBlock = ctx.currentSignals.map((s) =>
    `- [${s.signal_id}] [${s.source}] ${s.text.slice(0, 300)} (pain: ${s.pain}, timing: ${s.timing})`
  ).join('\n') || '(none)';

  const historicalBlock = ctx.historicalSignals.map((s) =>
    `- [${s.signal_id}] [${s.source}] ${s.text.slice(0, 300)} (pain: ${s.pain}, timing: ${s.timing})`
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

DEEP ANALYSIS:
1. What's the real pattern here? Look beyond individual signals at the underlying trend.
2. How has this area evolved over time? Compare current vs historical signals.
3. Should any existing thesis be updated? Should a new thesis be created?
4. Write detailed observations for your future self — what did you learn from this deep dive?

Return ONLY valid JSON:
{
  "thesis_updates": [{"canonicalKey": "...", "confidence_delta": <n>, "reasoning": "..."}],
  "new_theses": [{"title": "...", "problem_statement": "...", "target_buyer": "...", "proposed_solution": "...", "supporting_signal_ids": ["..."]}],
  "journal_entries": [{"entry_type": "...", "topic": "...", "insight": "...", "narrative": "...", "confidence": <n>, "thesis_keys": ["..."], "signal_ids": ["..."]}]
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

// === Legacy prompt (kept for backwards compatibility with old tests) ===

export const buildAgentPrompt = (ctx: AgentContext): string => {
  const thesesBlock = ctx.activeTheses.length > 0
    ? ctx.activeTheses.map((t) =>
        `- "${t.title}" (confidence: ${t.confidence}%, ${t.evidenceCount} signals, status: ${t.status})`
      ).join('\n')
    : '(none yet)';

  const signalsBlock = ctx.recentSignals.length > 0
    ? ctx.recentSignals.map((s) =>
        `- [${s.signal_id}] [${s.source}] ${s.text.slice(0, 200)} (pain: ${s.pain}, timing: ${s.timing})`
      ).join('\n')
    : '(no new signals)';

  const trendsBlock = ctx.trendSummary.length > 0
    ? ctx.trendSummary.map((t) =>
        `- "${t.topic}" ${t.window}: ${t.count} signals, avg pain ${t.avg_pain}, growth ${t.growth}`
      ).join('\n')
    : '(no trend data)';

  return `You are a SaaS opportunity researcher. Analyze accumulated intelligence and maintain thesis quality.

ACTIVE THESES:
${thesesBlock}

NEW SIGNALS SINCE LAST RUN:
${signalsBlock}

TREND WINDOWS:
${trendsBlock}

YOUR TASK:
1. Review new signals. Do any strengthen or weaken existing theses? Provide confidence_delta (-20 to +20) with reasoning.
2. Do new signals suggest a NEW thesis not yet tracked? Propose with title, problem, buyer, solution, and supporting signal IDs.
3. If any thesis should be promoted (confidence crossing 80%), include its canonicalKey in alerts.
4. Suggest one area to investigate deeper in the next run.

Return ONLY valid JSON:
{
  "theses_updated": [{"canonicalKey": "...", "confidence_delta": <n>, "reasoning": "..."}],
  "new_theses": [{"title": "...", "problem_statement": "...", "target_buyer": "...", "proposed_solution": "...", "supporting_signal_ids": ["..."]}],
  "alerts": ["canonicalKey of promoted theses"],
  "investigate_next": "topic or question to research next"
}`;
};

export const parseAgentResponse = (raw: string): AgentOutput | null => {
  try {
    const text = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(text) as AgentOutput;
    if (!Array.isArray(parsed.theses_updated)) return null;
    return {
      theses_updated: parsed.theses_updated ?? [],
      new_theses: parsed.new_theses ?? [],
      alerts: parsed.alerts ?? [],
      investigate_next: String(parsed.investigate_next ?? '')
    };
  } catch {
    return null;
  }
};
