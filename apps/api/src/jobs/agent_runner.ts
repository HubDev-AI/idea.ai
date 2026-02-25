import { buildAgentPrompt, parseAgentResponse, type AgentContext, type AgentOutput } from './research_agent';
import { dualAnalystRun } from '@idea/ai-runtime/src/dual_analyst';
import type { ThesisStore } from '../runtime/thesis_store';
import type { RunPromptResult } from '@idea/ai-runtime/src/types';

export type AgentRunResult = {
  thesesUpdated: number;
  newCandidates: number;
  alerts: string[];
  investigateNext: string;
};

export type AgentRunnerDeps = {
  thesisStore: ThesisStore;
  runClaude: (input: { prompt: string; timeoutMs?: number }) => Promise<RunPromptResult>;
  runCodex: (input: { prompt: string; timeoutMs?: number }) => Promise<RunPromptResult>;
};

export const runResearchAgent = async (deps: AgentRunnerDeps): Promise<AgentRunResult> => {
  // 1. Load context
  const allTheses = await deps.thesisStore.list();
  const activeTheses = allTheses
    .filter((t) => t.status !== 'stale' && t.status !== 'rejected')
    .slice(0, 10)
    .map((t) => ({
      canonicalKey: t.canonicalKey,
      title: t.title,
      confidence: t.confidence,
      status: t.status,
      evidenceCount: t.evidenceCount
    }));

  const ctx: AgentContext = {
    activeTheses,
    recentSignals: [], // TODO: wire to DB query for signals since last run
    trendSummary: []   // TODO: wire to trend window aggregation
  };

  // 2. Build prompt and run dual analyst
  const prompt = buildAgentPrompt(ctx);
  const dualResult = await dualAnalystRun<AgentOutput>(
    { prompt, timeoutMs: 60_000 },
    {
      runClaude: deps.runClaude,
      runCodex: deps.runCodex,
      parseResponse: (text) => {
        const parsed = parseAgentResponse(text);
        if (!parsed) throw new Error('Failed to parse agent response');
        return parsed;
      }
    }
  );

  // 3. Use Claude's result as primary, Codex as fallback
  const output = dualResult.claude ?? dualResult.codex;
  if (!output) {
    return { thesesUpdated: 0, newCandidates: 0, alerts: [], investigateNext: '' };
  }

  // 4. Apply thesis updates
  for (const update of output.theses_updated) {
    const existing = await deps.thesisStore.getByKey(update.canonicalKey);
    if (existing) {
      const newConfidence = Math.max(0, Math.min(100, existing.confidence + update.confidence_delta));
      const newStatus = newConfidence >= 80 ? 'promoted' : newConfidence >= 55 ? 'watching' : existing.status;
      await deps.thesisStore.upsert({
        ...existing,
        confidence: newConfidence,
        status: newStatus
      });
    }
  }

  // 5. Create new thesis candidates
  for (const proposal of output.new_theses) {
    const key = `agent:${proposal.title.toLowerCase().replace(/\s+/g, '_').slice(0, 40)}`;
    await deps.thesisStore.upsert({
      canonicalKey: key,
      title: proposal.title,
      topic: 'agent_generated',
      status: 'candidate',
      confidence: 45,
      scoreTotal: 45,
      problemStatement: proposal.problem_statement,
      targetBuyer: proposal.target_buyer,
      proposedSolution: proposal.proposed_solution,
      evidenceCount: proposal.supporting_signal_ids.length,
      avgPain: 50,
      avgTiming: 50,
      avgBuildability: 50,
      latestObservedAt: new Date().toISOString(),
      evidence: []
    });
  }

  return {
    thesesUpdated: output.theses_updated.length,
    newCandidates: output.new_theses.length,
    alerts: output.alerts,
    investigateNext: output.investigate_next
  };
};
