import type { Provider, RunPromptInput, RunPromptResult } from '@idea/ai-runtime/src/types';
import type { ExecutionLogger } from '../runtime/execution_logger';
import type { ProviderCircuitBreaker } from '../runtime/provider_circuit';
import { clampConfidence, clampScore, otherProvider, parseJsonObject, resolveFallbackProvider, resolvePreferredProvider, runProvider, toPositiveInt } from './ai_helpers';

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
  demand?: number;
  timing?: number;
  virality?: number;
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

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_SIGNALS = 6;

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
    const demandRaw = row.demand ?? row.pain; // backward compat: accept legacy pain field
    const demand = Number.isFinite(Number(demandRaw)) ? clampScore(Number(demandRaw)) : undefined;
    const timing = Number.isFinite(Number(row.timing)) ? clampScore(Number(row.timing)) : undefined;
    const virality = Number.isFinite(Number(row.virality)) ? clampScore(Number(row.virality)) : undefined;
    const judgeScores = parseJudgeScores(row.judge_scores);
    const confidence = Number.isFinite(Number(row.confidence))
      ? clampConfidence(Number(row.confidence))
      : undefined;
    const isNoise = typeof row.is_noise === 'boolean' ? row.is_noise : undefined;
    const rationale = typeof row.rationale === 'string' ? row.rationale.trim() : undefined;

    const insight: AiPostScrapeInsight = { id };
    const trimmedIdea = idea && idea.length > 0 ? idea.slice(0, 90) : undefined;
    if (trimmedIdea !== undefined) insight.idea = trimmedIdea;
    if (demand !== undefined) insight.demand = demand;
    if (timing !== undefined) insight.timing = timing;
    if (virality !== undefined) insight.virality = virality;
    if (judgeScores !== undefined) insight.judgeScores = judgeScores;
    if (confidence !== undefined) insight.confidence = confidence;
    if (isNoise !== undefined) insight.isNoise = isNoise;
    if (rationale !== undefined) insight.rationale = rationale;

    insights.set(id, insight);
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
    'You are a product opportunity analyst specializing in viral and high-growth products.',
    'Analyze each scraped signal and return only valid JSON.',
    'Consider consumer apps, social platforms, viral tools, and SaaS products.',
    'Output format:',
    '{"signals":[{"id":"...","idea":"...","demand":0-100,"timing":0-100,"virality":0-100,"judge_scores":[0-100,0-100,0-100],"confidence":0-1,"is_noise":false,"rationale":"short"}]}',
    'Rules:',
    '- Keep id exactly as provided.',
    '- idea must be a market-facing product opportunity title, max 90 chars.',
    '- demand and timing are integers from 0 to 100.',
    '- virality (0-100): How likely is this product to spread organically through network effects, sharing, or word of mouth?',
    '- judge_scores must contain exactly 3 integers in [0,100] for buildability consensus.',
    '- is_noise=true for repo-local chores or low-opportunity implementation detail items.',
    '- rationale must be short (1 sentence).',
    '',
    `Signals (${payload.length}):`,
    JSON.stringify(payload)
  ].join('\n');
};

export const resolveAiPostScrapeSettings = (env: NodeJS.ProcessEnv = process.env): AiPostScrapeSettings => {
  const isTest = env.NODE_ENV === 'test' || env.VITEST === 'true';

  return {
    enabled: env.AI_POST_SCRAPE_ENABLED !== 'false',
    preferredProvider: resolvePreferredProvider(env),
    allowFallback: resolveFallbackProvider(env) !== null,
    maxSignals: toPositiveInt(env.AI_POST_SCRAPE_MAX_SIGNALS, isTest ? 0 : DEFAULT_MAX_SIGNALS),
    timeoutMs: toPositiveInt(env.AI_TIMEOUT_MS ?? env.AI_POST_SCRAPE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    retries: toPositiveInt(env.AI_RETRIES ?? env.AI_PROVIDER_RETRIES, 1)
  };
};

const BATCH_SIZE = 25;

const analyzeChunk = async ({
  chunk,
  settings,
  logger,
  run,
  circuit
}: {
  chunk: AiPostScrapeInput[];
  settings: AiPostScrapeSettings;
  logger?: ExecutionLogger;
  run?: (input: RunPromptInput) => Promise<RunPromptResult>;
  circuit?: ProviderCircuitBreaker;
}): Promise<{
  insights: Map<string, AiPostScrapeInsight>;
  provider?: Provider;
  attempts: AiPostScrapeAttempt[];
}> => {
  const prompt = buildPrompt(chunk);

  // Circuit breaker determines provider order — skips providers that are consistently failing
  const providersToTry = circuit
    ? circuit.getProviderOrder(settings.preferredProvider, settings.allowFallback)
    : (() => {
        const list = [settings.preferredProvider];
        if (settings.allowFallback) {
          const fallback = otherProvider(settings.preferredProvider);
          if (!list.includes(fallback)) list.push(fallback);
        }
        return list;
      })();

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
          circuit?.recordFailure(result.provider, 'response parse failed');
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
        circuit?.recordSuccess(result.provider);

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
        circuit?.recordFailure(provider, message);
        await logger?.warn('ai_post_scrape', 'ai post-scrape call failed for provider', {
          provider,
          attempt,
          max_attempts: maxAttempts,
          will_retry: willRetry,
          error: message,
          circuit_state: circuit ? circuit.getStatus()[provider].state : undefined
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
  run,
  circuit
}: {
  inputs: AiPostScrapeInput[];
  settings: AiPostScrapeSettings;
  logger?: ExecutionLogger;
  run?: (input: RunPromptInput) => Promise<RunPromptResult>;
  circuit?: ProviderCircuitBreaker;
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
    const chunkOpts: Parameters<typeof analyzeChunk>[0] = { chunk, settings };
    if (logger) chunkOpts.logger = logger;
    if (run) chunkOpts.run = run;
    if (circuit) chunkOpts.circuit = circuit;
    const result = await analyzeChunk(chunkOpts);
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

  const batchResult: AiPostScrapeResult = {
    insights: allInsights,
    fromAi: anySuccess,
    attempted: true,
    attempts: allAttempts
  };
  if (lastProvider) batchResult.provider = lastProvider;
  return batchResult;
};
