import { runClaudePrompt } from '@idea/ai-runtime/src/claude';
import { runCodexPrompt } from '@idea/ai-runtime/src/codex';
import type { Provider, RunPromptInput, RunPromptResult } from '@idea/ai-runtime/src/types';
import type { ExecutionLogger } from '../runtime/execution_logger';

export type AiPostScrapeSettings = {
  enabled: boolean;
  preferredProvider: Provider;
  allowFallback: boolean;
  maxSignals: number;
  timeoutMs: number;
  retries: number;
};

export type AiPostScrapeInput = {
  id: string;
  source: string;
  topic: string;
  ideaDraft: string;
  text: string;
};

export type AiPostScrapeInsight = {
  id: string;
  idea?: string;
  pain?: number;
  timing?: number;
  judgeScores?: [number, number, number];
  confidence?: number;
  isNoise?: boolean;
  rationale?: string;
};

export type AiPostScrapeResult = {
  insights: Map<string, AiPostScrapeInsight>;
  fromAi: boolean;
  provider?: Provider;
  attempted: boolean;
  attempts: AiPostScrapeAttempt[];
};

export type AiPostScrapeAttempt = {
  provider: Provider;
  attempt: number;
  success: boolean;
  retried: boolean;
  error?: string;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_SIGNALS = 6;

const clampScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
const clampConfidence = (value: number): number => Math.max(0, Math.min(1, value));

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
};

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

const parseJudgeScores = (value: unknown): [number, number, number] | undefined => {
  if (!Array.isArray(value) || value.length < 3) {
    return undefined;
  }

  const parsed = value
    .slice(0, 3)
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));

  if (parsed.length !== 3) {
    return undefined;
  }

  return [clampScore(parsed[0] ?? 0), clampScore(parsed[1] ?? 0), clampScore(parsed[2] ?? 0)];
};

export const parseAiPostScrapeInsights = (text: string): Map<string, AiPostScrapeInsight> => {
  const parsed = parseJsonObject(text) as { signals?: unknown } | null;
  if (!parsed || !Array.isArray(parsed.signals)) {
    return new Map();
  }

  const insights = new Map<string, AiPostScrapeInsight>();
  for (const entry of parsed.signals) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const row = entry as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id) {
      continue;
    }

    const idea = typeof row.idea === 'string' ? row.idea.trim() : undefined;
    const pain = Number.isFinite(Number(row.pain)) ? clampScore(Number(row.pain)) : undefined;
    const timing = Number.isFinite(Number(row.timing)) ? clampScore(Number(row.timing)) : undefined;
    const judgeScores = parseJudgeScores(row.judge_scores);
    const confidence = Number.isFinite(Number(row.confidence))
      ? clampConfidence(Number(row.confidence))
      : undefined;
    const isNoise = typeof row.is_noise === 'boolean' ? row.is_noise : undefined;
    const rationale = typeof row.rationale === 'string' ? row.rationale.trim() : undefined;

    insights.set(id, {
      id,
      idea: idea && idea.length > 0 ? idea.slice(0, 90) : undefined,
      pain,
      timing,
      judgeScores,
      confidence,
      isNoise,
      rationale
    });
  }

  return insights;
};

const buildPrompt = (items: AiPostScrapeInput[]): string => {
  const payload = items.map((item) => ({
    id: item.id,
    source: item.source,
    topic: item.topic,
    idea_draft: item.ideaDraft,
    evidence: item.text.slice(0, 320)
  }));

  return [
    'You are a strict SaaS opportunity analyst.',
    'Analyze each scraped signal and return only valid JSON.',
    'Output format:',
    '{"signals":[{"id":"...","idea":"...","pain":0-100,"timing":0-100,"judge_scores":[0-100,0-100,0-100],"confidence":0-1,"is_noise":false,"rationale":"short"}]}',
    'Rules:',
    '- Keep id exactly as provided.',
    '- idea must be a market-facing SaaS opportunity title, max 90 chars.',
    '- pain and timing are integers from 0 to 100.',
    '- judge_scores must contain exactly 3 integers in [0,100] for buildability consensus.',
    '- is_noise=true for repo-local chores or low-opportunity implementation detail items.',
    '- rationale must be short (1 sentence).',
    '',
    `Signals (${payload.length}):`,
    JSON.stringify(payload)
  ].join('\n');
};

const runProvider = async (
  provider: Provider,
  input: RunPromptInput,
  run?: (input: RunPromptInput) => Promise<RunPromptResult>
): Promise<RunPromptResult> => {
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

export const resolveAiPostScrapeSettings = (env: NodeJS.ProcessEnv = process.env): AiPostScrapeSettings => {
  const providerRaw = env.AI_PROVIDER?.toLowerCase();
  const preferredProvider =
    providerRaw === 'both'
      ? env.AI_PROVIDER_PRIMARY === 'codex'
        ? 'codex'
        : 'claude'
      : providerRaw === 'codex'
        ? 'codex'
        : 'claude';
  const isTest = env.NODE_ENV === 'test' || env.VITEST === 'true';

  return {
    enabled: env.AI_POST_SCRAPE_ENABLED !== 'false',
    preferredProvider,
    allowFallback: providerRaw === 'both' || env.AI_PROVIDER_FALLBACK === 'true',
    maxSignals: toPositiveInt(env.AI_POST_SCRAPE_MAX_SIGNALS, isTest ? 0 : DEFAULT_MAX_SIGNALS),
    timeoutMs: toPositiveInt(env.AI_POST_SCRAPE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    retries: toPositiveInt(env.AI_PROVIDER_RETRIES, 1)
  };
};

const BATCH_SIZE = 25;

const analyzeChunk = async ({
  chunk,
  settings,
  logger,
  run
}: {
  chunk: AiPostScrapeInput[];
  settings: AiPostScrapeSettings;
  logger?: ExecutionLogger;
  run?: (input: RunPromptInput) => Promise<RunPromptResult>;
}): Promise<{
  insights: Map<string, AiPostScrapeInsight>;
  provider?: Provider;
  attempts: AiPostScrapeAttempt[];
}> => {
  const prompt = buildPrompt(chunk);
  const providersToTry = [settings.preferredProvider];
  if (settings.allowFallback) {
    const fallback = otherProvider(settings.preferredProvider);
    if (!providersToTry.includes(fallback)) {
      providersToTry.push(fallback);
    }
  }

  const attempts: AiPostScrapeAttempt[] = [];

  for (const provider of providersToTry) {
    const maxAttempts = Math.max(1, settings.retries + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await runProvider(
          provider,
          {
            prompt,
            timeoutMs: settings.timeoutMs,
            preferredProvider: provider
          },
          run
        );
        const insights = parseAiPostScrapeInsights(result.text);
        if (insights.size === 0) {
          const willRetry = attempt < maxAttempts;
          attempts.push({
            provider: result.provider,
            attempt,
            success: false,
            retried: willRetry,
            error: 'response parse failed'
          });
          await logger?.warn('ai_post_scrape', 'ai post-scrape analysis parse failed', {
            provider: result.provider,
            requested_signals: chunk.length,
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

        return { insights, provider: result.provider, attempts };
      } catch (error) {
        const willRetry = attempt < maxAttempts;
        const message = error instanceof Error ? error.message : 'Unknown error';
        attempts.push({
          provider,
          attempt,
          success: false,
          retried: willRetry,
          error: message
        });
        await logger?.warn('ai_post_scrape', 'ai post-scrape call failed for provider', {
          provider,
          attempt,
          max_attempts: maxAttempts,
          will_retry: willRetry,
          error: message
        });
      }
    }
  }

  return { insights: new Map(), attempts };
};

export const analyzePostScrapeBatchWithAi = async ({
  inputs,
  settings,
  logger,
  run
}: {
  inputs: AiPostScrapeInput[];
  settings: AiPostScrapeSettings;
  logger?: ExecutionLogger;
  run?: (input: RunPromptInput) => Promise<RunPromptResult>;
}): Promise<AiPostScrapeResult> => {
  if (!settings.enabled || settings.maxSignals <= 0 || inputs.length === 0) {
    return {
      insights: new Map(),
      fromAi: false,
      attempted: false,
      attempts: []
    };
  }

  const selected = inputs.slice(0, settings.maxSignals);
  const chunks: AiPostScrapeInput[][] = [];
  for (let i = 0; i < selected.length; i += BATCH_SIZE) {
    chunks.push(selected.slice(i, i + BATCH_SIZE));
  }

  const allInsights = new Map<string, AiPostScrapeInsight>();
  const allAttempts: AiPostScrapeAttempt[] = [];
  let lastProvider: Provider | undefined;
  let anySuccess = false;

  for (const chunk of chunks) {
    const result = await analyzeChunk({ chunk, settings, logger, run });
    for (const [id, insight] of result.insights) {
      allInsights.set(id, insight);
    }
    allAttempts.push(...result.attempts);
    if (result.provider) {
      lastProvider = result.provider;
    }
    if (result.insights.size > 0) {
      anySuccess = true;
    }
  }

  await logger?.info('ai_post_scrape', 'ai post-scrape analysis succeeded', {
    provider: lastProvider ?? null,
    requested_signals: selected.length,
    analyzed_signals: allInsights.size,
    batches: chunks.length
  });

  return {
    insights: allInsights,
    fromAi: anySuccess,
    provider: lastProvider,
    attempted: true,
    attempts: allAttempts
  };
};
