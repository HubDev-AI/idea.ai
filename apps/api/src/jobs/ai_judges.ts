import { runClaudePrompt } from '@idea/ai-runtime/src/claude';
import { runCodexPrompt } from '@idea/ai-runtime/src/codex';
import type { Provider, RunPromptInput, RunPromptResult } from '@idea/ai-runtime/src/types';
import type { ExecutionLogger } from '../runtime/execution_logger';
import type { ProviderCircuitBreaker } from '../runtime/provider_circuit';

const defaultJudgeScores: [number, number, number] = [62, 66, 60];
const opportunityKeywords = [
  'pain',
  'struggle',
  'manual',
  'outage',
  'incident',
  'friction',
  'costly',
  'churn',
  'compliance',
  'billing',
  'invoice',
  'support backlog',
  'error',
  'failure'
];

const clampScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const fallbackJudgeScores = (): [number, number, number] => [...defaultJudgeScores] as [number, number, number];

const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : 'Unknown error');

const parseJsonObject = (text: string): unknown => {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

export const parseJudgeScores = (text: string): [number, number, number] | null => {
  const parsed = parseJsonObject(text) as { judge_scores?: unknown } | null;
  if (parsed && Array.isArray(parsed.judge_scores) && parsed.judge_scores.length >= 3) {
    const scores = parsed.judge_scores.slice(0, 3).map((value) => Number(value));
    if (scores.every((score) => Number.isFinite(score))) {
      return [clampScore(scores[0] ?? 0), clampScore(scores[1] ?? 0), clampScore(scores[2] ?? 0)];
    }
  }

  const fallbackNumbers = Array.from(text.matchAll(/-?\d+(\.\d+)?/g))
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value))
    .slice(0, 3);

  if (fallbackNumbers.length === 3) {
    return [
      clampScore(fallbackNumbers[0] ?? 0),
      clampScore(fallbackNumbers[1] ?? 0),
      clampScore(fallbackNumbers[2] ?? 0)
    ];
  }

  return null;
};

const buildJudgePrompt = ({
  idea,
  text,
  topic,
  source
}: {
  idea: string;
  text: string;
  topic: string;
  source: string;
}): string =>
  [
    'You are evaluating a possible product opportunity.',
    'Score BUILDABILITY using three independent judges.',
    'Each judge must output an integer between 0 and 100.',
    'Return ONLY this exact format with no extra text: n1,n2,n3',
    `Source: ${source}`,
    `Topic: ${topic}`,
    `Idea: ${idea}`,
    `Evidence: ${text.slice(0, 1600)}`
  ].join('\n');

export type AiJudgeSettings = {
  preferredProvider: Provider;
  mode: 'single' | 'ensemble';
  maxSignals: number;
  timeoutMs: number;
  allowFallback: boolean;
  retries: number;
};

export type AiJudgeAttempt = {
  provider: Provider;
  attempt: number;
  success: boolean;
  retried: boolean;
  error?: string;
};

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
};

export const resolveAiJudgeSettings = (env: NodeJS.ProcessEnv = process.env): AiJudgeSettings => {
  const providerRaw = env.AI_PROVIDER?.toLowerCase();
  const modeRaw = env.AI_PROVIDER_MODE?.toLowerCase();
  const mode = providerRaw === 'both' && modeRaw === 'ensemble' ? 'ensemble' : 'single';
  const preferredProvider =
    providerRaw === 'both'
      ? env.AI_PROVIDER_PRIMARY === 'codex'
        ? 'codex'
        : 'claude'
      : providerRaw === 'codex'
        ? 'codex'
        : 'claude';
  const isTest = env.NODE_ENV === 'test' || env.VITEST === 'true';
  const defaultMaxSignals = isTest ? 0 : 50;

  return {
    preferredProvider,
    mode,
    maxSignals: toPositiveInt(env.AI_JUDGE_MAX_SIGNALS, defaultMaxSignals),
    timeoutMs: toPositiveInt(env.AI_JUDGE_TIMEOUT_MS, 180_000),
    allowFallback: env.AI_PROVIDER_FALLBACK === 'true',
    retries: toPositiveInt(env.AI_PROVIDER_RETRIES, 1)
  };
};

export const isAiJudgeEligible = (text: string): boolean => {
  const normalized = text.toLowerCase();
  return opportunityKeywords.some((keyword) => normalized.includes(keyword));
};

export const judgeBuildabilityWithAi = async ({
  idea,
  text,
  topic,
  source,
  settings,
  logger,
  run,
  circuit
}: {
  idea: string;
  text: string;
  topic: string;
  source: string;
  settings: AiJudgeSettings;
  logger?: ExecutionLogger;
  run?: (input: RunPromptInput) => Promise<RunPromptResult>;
  circuit?: ProviderCircuitBreaker;
}): Promise<{
  judgeScores: [number, number, number];
  fromAi: boolean;
  provider?: Provider;
  providers?: Provider[];
  attempts: AiJudgeAttempt[];
}> => {
  const prompt = buildJudgePrompt({ idea, text, topic, source });

  const runProvider = (provider: Provider, input: RunPromptInput): Promise<RunPromptResult> => {
    if (run) {
      return run({
        ...input,
        preferredProvider: provider
      });
    }

    if (provider === 'codex') {
      return runCodexPrompt({
        ...input,
        preferredProvider: 'codex'
      });
    }

    return runClaudePrompt({
      ...input,
      preferredProvider: 'claude'
    });
  };

  const otherProvider = (provider: Provider): Provider => (provider === 'codex' ? 'claude' : 'codex');

  const attempts: AiJudgeAttempt[] = [];

  const callJudge = async (
    provider: Provider
  ): Promise<{ provider: Provider; scores: [number, number, number] } | null> => {
    const retryBudget = Number.isFinite(settings.retries) ? settings.retries : 0;
    const maxAttempts = Math.max(1, retryBudget + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await runProvider(provider, {
          prompt,
          timeoutMs: settings.timeoutMs,
          preferredProvider: provider
        });
        const parsedScores = parseJudgeScores(result.text);
        if (!parsedScores) {
          const willRetry = attempt < maxAttempts;
          const error = 'response parse failed';
          attempts.push({
            provider: result.provider,
            attempt,
            success: false,
            retried: willRetry,
            error
          });
          circuit?.recordFailure(result.provider, error);
          await logger?.warn('ai_judges', 'ai response parse failed for provider', {
            source,
            idea,
            provider: result.provider,
            attempt,
            max_attempts: maxAttempts,
            will_retry: willRetry
          });
          continue;
        }

        attempts.push({
          provider: result.provider,
          attempt,
          success: true,
          retried: attempt > 1
        });
        circuit?.recordSuccess(result.provider);
        await logger?.info('ai_judges', 'ai judge call succeeded for provider', {
          source,
          idea,
          provider: result.provider,
          attempt
        });

        return {
          provider: result.provider,
          scores: parsedScores
        };
      } catch (error) {
        const willRetry = attempt < maxAttempts;
        const message = toErrorMessage(error);
        attempts.push({
          provider,
          attempt,
          success: false,
          retried: willRetry,
          error: message
        });
        circuit?.recordFailure(provider, message);
        await logger?.warn('ai_judges', 'ai judge call failed for provider', {
          source,
          idea,
          provider,
          attempt,
          max_attempts: maxAttempts,
          will_retry: willRetry,
          error: message,
          circuit_state: circuit ? circuit.getStatus()[provider].state : undefined
        });
      }
    }

    return null;
  };

  const combineScores = (left: [number, number, number], right: [number, number, number]): [number, number, number] => [
    clampScore((left[0] + right[0]) / 2),
    clampScore((left[1] + right[1]) / 2),
    clampScore((left[2] + right[2]) / 2)
  ];

  try {
    if (settings.mode === 'ensemble') {
      const providerOrder: Provider[] = circuit
        ? circuit.getProviderOrder(settings.preferredProvider, true)
        : [settings.preferredProvider, otherProvider(settings.preferredProvider)];
      const results: Array<{ provider: Provider; scores: [number, number, number] }> = [];

      for (const provider of providerOrder) {
        const judged = await callJudge(provider);
        if (judged) {
          results.push(judged);
        }
      }

      if (results.length === 0) {
        await logger?.warn('ai_judges', 'ai judge calls unavailable in ensemble mode, using fallback judge scores', {
          source,
          idea
        });

        return {
          judgeScores: fallbackJudgeScores(),
          fromAi: false,
          attempts
        };
      }

      if (results.length === 1) {
        return {
          judgeScores: results[0]!.scores,
          fromAi: true,
          provider: results[0]!.provider,
          providers: [results[0]!.provider],
          attempts
        };
      }

      return {
        judgeScores: combineScores(results[0]!.scores, results[1]!.scores),
        fromAi: true,
        provider: results[0]!.provider,
        providers: [results[0]!.provider, results[1]!.provider],
        attempts
      };
    }

    // Circuit breaker determines provider order — skips providers that are consistently failing
    const providersToTry = circuit
      ? circuit.getProviderOrder(settings.preferredProvider, settings.allowFallback)
      : (() => {
          const list: Provider[] = [settings.preferredProvider];
          if (settings.allowFallback) {
            list.push(otherProvider(settings.preferredProvider));
          }
          return list;
        })();

    for (const provider of providersToTry) {
      const judged = await callJudge(provider);
      if (!judged) {
        continue;
      }

      return {
        judgeScores: judged.scores,
        fromAi: true,
        provider: judged.provider,
        providers: [judged.provider],
        attempts
      };
    }

    await logger?.warn('ai_judges', 'ai judge calls unavailable, using fallback judge scores', {
      source,
      idea
    });

    return {
      judgeScores: fallbackJudgeScores(),
      fromAi: false,
      attempts
    };
  } catch (error) {
    await logger?.warn('ai_judges', 'ai judge call failed, using fallback judge scores', {
      source,
      idea,
      error: toErrorMessage(error)
    });

    return {
      judgeScores: fallbackJudgeScores(),
      fromAi: false,
      attempts
    };
  }
};
