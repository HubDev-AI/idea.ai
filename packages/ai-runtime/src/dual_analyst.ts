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

export class NoUsableProviderResponseError extends Error {
  readonly failures: Array<{ provider: 'claude' | 'codex'; error: string }>;

  constructor(failures: Array<{ provider: 'claude' | 'codex'; error: string }>) {
    super(`No AI provider returned a usable response: ${failures.map((f) => `${f.provider}: ${f.error}`).join('; ')}`);
    this.name = 'NoUsableProviderResponseError';
    this.failures = failures;
  }
}

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
    preferred?: 'claude' | 'codex';
    allowFallback?: boolean;
  }
): Promise<DualResult<T>> => {
  const log = deps.logger;
  const preferred = deps.preferred ?? 'claude';
  const allowFallback = deps.allowFallback ?? true;
  const strategy = allowFallback ? 'primary_with_fallback' : 'single_provider';

  let claude: T | null = null;
  let codex: T | null = null;
  const failures: Array<{ provider: 'claude' | 'codex'; error: string }> = [];

  const runPrimary = preferred === 'claude' ? deps.runClaude : deps.runCodex;
  const runFallback = preferred === 'claude' ? deps.runCodex : deps.runClaude;
  const primaryLabel = preferred;
  const fallbackLabel = preferred === 'claude' ? 'codex' : 'claude';

  // Step 1: Try preferred provider
  try {
    const result = await runPrimary(input);
    const parsed = deps.parseResponse(result.text);
    if (preferred === 'claude') claude = parsed; else codex = parsed;
    await log?.info('ai_provider', `${primaryLabel} succeeded`, { parsed: true, strategy, preferred });
    return { claude, codex };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'unknown';
    failures.push({ provider: primaryLabel, error });
    await log?.warn('ai_provider', `${primaryLabel} failed`, {
      error,
      strategy,
      preferred,
    });
  }

  // Step 2: Try fallback provider (only if allowed)
  if (allowFallback) {
    try {
      const result = await runFallback(input);
      const parsed = deps.parseResponse(result.text);
      if (fallbackLabel === 'claude') claude = parsed; else codex = parsed;
      await log?.info('ai_provider', `${fallbackLabel} succeeded`, { parsed: true, strategy, preferred });
      return { claude, codex };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'unknown';
      failures.push({ provider: fallbackLabel, error });
      await log?.warn('ai_provider', `${fallbackLabel} failed`, {
        error,
        strategy,
        preferred,
      });
    }
  }

  // Retry primary if it failed (and fallback was skipped or also failed)
  if (claude === null && codex === null) {
    await log?.info('ai_provider', `retrying ${primaryLabel}`, { strategy, preferred });
    try {
      const retry = await runPrimary(input);
      try {
        const parsed = deps.parseResponse(retry.text);
        if (preferred === 'claude') claude = parsed; else codex = parsed;
      } catch (err) {
        const error = err instanceof Error ? err.message : 'unknown';
        failures.push({ provider: primaryLabel, error });
      }
      await log?.info('ai_provider', `${primaryLabel} retry result`, {
        parsed: claude !== null || codex !== null,
        strategy,
        preferred,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : 'unknown';
      failures.push({ provider: primaryLabel, error });
    }
  }

  if (claude === null && codex === null) {
    throw new NoUsableProviderResponseError(failures);
  }

  return { claude, codex };
};
