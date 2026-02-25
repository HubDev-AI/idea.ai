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

export type AgentContext = {
  activeTheses: AgentThesisSummary[];
  recentSignals: AgentSignalSummary[];
  trendSummary: AgentTrendSummary[];
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

export type AgentOutput = {
  theses_updated: ThesisUpdate[];
  new_theses: NewThesisProposal[];
  alerts: string[];
  investigate_next: string;
};

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
    const parsed = JSON.parse(raw) as AgentOutput;
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
