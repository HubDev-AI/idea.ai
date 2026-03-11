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
    retries?: number;
  }
): Promise<DualResult<T>> => {
  const log = deps.logger;
  const preferred = deps.preferred ?? 'claude';
  const allowFallback = deps.allowFallback ?? true;
  const strategy = allowFallback ? 'primary_with_fallback' : 'single_provider';
  const retryBudget = Number.isFinite(deps.retries) ? Math.max(0, Math.trunc(deps.retries ?? 0)) : 0;

  let claude: T | null = null;
  let codex: T | null = null;
  const failures: Array<{ provider: 'claude' | 'codex'; error: string }> = [];

  const primaryLabel = preferred;
  const fallbackLabel = preferred === 'claude' ? 'codex' : 'claude';
  const providersToTry: Array<{ label: 'claude' | 'codex'; run: (input: RunPromptInput) => Promise<RunPromptResult> }> = [
    { label: primaryLabel, run: preferred === 'claude' ? deps.runClaude : deps.runCodex },
  ];
  if (allowFallback) {
    providersToTry.push({
      label: fallbackLabel,
      run: preferred === 'claude' ? deps.runCodex : deps.runClaude,
    });
  }

  for (const provider of providersToTry) {
    const maxAttempts = Math.max(1, retryBudget + 1);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await provider.run(input);
        const parsed = deps.parseResponse(result.text);
        if (provider.label === 'claude') claude = parsed; else codex = parsed;
        await log?.info('ai_provider', `${provider.label} succeeded`, {
          parsed: true,
          strategy,
          preferred,
          attempt,
          max_attempts: maxAttempts,
        });
        return { claude, codex };
      } catch (err) {
        const error = err instanceof Error ? err.message : 'unknown';
        failures.push({ provider: provider.label, error });
        await log?.warn('ai_provider', `${provider.label} failed`, {
          error,
          strategy,
          preferred,
          attempt,
          max_attempts: maxAttempts,
          will_retry: attempt < maxAttempts,
        });
      }
    }
  }

  if (claude === null && codex === null) {
    throw new NoUsableProviderResponseError(failures);
  }

  return { claude, codex };
};
