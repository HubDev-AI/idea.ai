import type { RunPromptInput, RunPromptResult } from './types';

export type ScoreQuad = { demand: number; timing: number; buildability: number; virality: number };

export type ReconciledScore = ScoreQuad & {
  agreement: 'aligned' | 'contested' | 'single' | 'unavailable';
  contestedDimensions: string[];
};

export type DualResult<T> = {
  claude: T | null;
  codex: T | null;
};

const DISAGREEMENT_THRESHOLD = 25;

const avg = (a: number, b: number) => Math.round((a + b) / 2);

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

type LogFn = (component: string, message: string, context?: Record<string, unknown>) => Promise<void>;

export const dualAnalystRun = async <T>(
  input: RunPromptInput,
  deps: {
    runClaude: (input: RunPromptInput) => Promise<RunPromptResult>;
    runCodex: (input: RunPromptInput) => Promise<RunPromptResult>;
    parseResponse: (text: string) => T;
    logger?: { info: LogFn; warn: LogFn };
  }
): Promise<DualResult<T>> => {
  const log = deps.logger;

  const [claudeResult, codexResult] = await Promise.allSettled([
    deps.runClaude(input),
    deps.runCodex(input)
  ]);

  let claude: T | null = null;
  let codex: T | null = null;

  if (claudeResult.status === 'fulfilled') {
    try { claude = deps.parseResponse(claudeResult.value.text); } catch { /* skip */ }
    await log?.info('dual_analyst', 'claude succeeded', { parsed: claude !== null });
  } else {
    await log?.warn('dual_analyst', 'claude failed', { error: claudeResult.reason?.message ?? 'unknown' });
  }

  if (codexResult.status === 'fulfilled') {
    try { codex = deps.parseResponse(codexResult.value.text); } catch { /* skip */ }
    await log?.info('dual_analyst', 'codex succeeded', { parsed: codex !== null });
  } else {
    await log?.warn('dual_analyst', 'codex failed', { error: codexResult.reason?.message ?? 'unknown' });
  }

  // Retry if both providers failed
  if (claude === null && codex === null) {
    // Try Claude first
    await log?.info('dual_analyst', 'both failed, retrying claude');
    try {
      const retry = await deps.runClaude(input);
      try { claude = deps.parseResponse(retry.text); } catch { /* skip */ }
      await log?.info('dual_analyst', 'claude retry result', { parsed: claude !== null });
    } catch { /* exhausted */ }

    // If Claude retry also failed, try Codex
    if (claude === null) {
      await log?.info('dual_analyst', 'claude retry failed, trying codex');
      try {
        const retry = await deps.runCodex(input);
        try { codex = deps.parseResponse(retry.text); } catch { /* skip */ }
        await log?.info('dual_analyst', 'codex retry result', { parsed: codex !== null });
      } catch { /* both retries exhausted */ }
    }
  }

  // Retry with Claude if both providers failed
  if (claude === null && codex === null) {
    try {
      const retry = await deps.runClaude(input);
      try { claude = deps.parseResponse(retry.text); } catch { /* skip */ }
    } catch { /* both attempts exhausted */ }
  }

  return { claude, codex };
};
