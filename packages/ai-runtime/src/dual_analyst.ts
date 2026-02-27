import type { RunPromptInput, RunPromptResult } from './types';

export type ScoreTriplet = { pain: number; timing: number; buildability: number };

export type ReconciledScore = ScoreTriplet & {
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
  claudeScores: ScoreTriplet | null,
  codexScores: ScoreTriplet | null
): ReconciledScore => {
  if (!claudeScores && !codexScores) {
    return { pain: 0, timing: 0, buildability: 0, agreement: 'unavailable', contestedDimensions: [] };
  }

  if (!claudeScores || !codexScores) {
    const s = (claudeScores ?? codexScores)!;
    return { ...s, agreement: 'single', contestedDimensions: [] };
  }

  const contested: string[] = [];
  for (const dim of ['pain', 'timing', 'buildability'] as const) {
    if (Math.abs(claudeScores[dim] - codexScores[dim]) > DISAGREEMENT_THRESHOLD) {
      contested.push(dim);
    }
  }

  return {
    pain: avg(claudeScores.pain, codexScores.pain),
    timing: avg(claudeScores.timing, codexScores.timing),
    buildability: avg(claudeScores.buildability, codexScores.buildability),
    agreement: contested.length > 0 ? 'contested' : 'aligned',
    contestedDimensions: contested
  };
};

export const dualAnalystRun = async <T>(
  input: RunPromptInput,
  deps: {
    runClaude: (input: RunPromptInput) => Promise<RunPromptResult>;
    runCodex: (input: RunPromptInput) => Promise<RunPromptResult>;
    parseResponse: (text: string) => T;
  }
): Promise<DualResult<T>> => {
  const [claudeResult, codexResult] = await Promise.allSettled([
    deps.runClaude(input),
    deps.runCodex(input)
  ]);

  let claude: T | null = null;
  let codex: T | null = null;

  if (claudeResult.status === 'fulfilled') {
    try { claude = deps.parseResponse(claudeResult.value.text); } catch { /* skip */ }
  }

  if (codexResult.status === 'fulfilled') {
    try { codex = deps.parseResponse(codexResult.value.text); } catch { /* skip */ }
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
