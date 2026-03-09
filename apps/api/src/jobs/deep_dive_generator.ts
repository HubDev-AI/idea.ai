import type { RunPromptInput, RunPromptResult } from '@idea/ai-runtime/src/types';
import type { ExecutionLogger } from '../runtime/execution_logger';
import { parseJsonObject } from './ai_helpers';

export type DeepDiveInput = {
  title: string;
  problemStatement: string;
  targetBuyer: string;
  proposedSolution: string;
  confidence: number;
};

export type DeepDiveResult = {
  summary: string;
  howItWorks: string;
  growthStrategy: string;
  buildSuggestions: string;
};

export type DeepDiveGeneratorDeps = {
  runClaude: (input: RunPromptInput) => Promise<RunPromptResult>;
  runCodex: (input: RunPromptInput) => Promise<RunPromptResult>;
  preferredProvider?: 'claude' | 'codex';
  allowFallback?: boolean;
  logger?: Pick<ExecutionLogger, 'info' | 'warn' | 'debug' | 'error'>;
};

const TIMEOUT_MS = 60_000;

const buildPrompt = (input: DeepDiveInput): string =>
  `You are a product strategist analyzing a startup idea for a solo founder.

Given this product thesis:
- Title: ${input.title}
- Problem: ${input.problemStatement}
- Target buyer: ${input.targetBuyer}
- Proposed solution: ${input.proposedSolution}
- Confidence: ${input.confidence}%

Generate a concise deep-dive analysis. Keep each section 2-4 sentences max.
Focus on actionability -- what would a solo founder need to know to decide whether to build this?

Return ONLY valid JSON (no markdown, no code fences):
{
  "summary": "What this idea is and why it matters right now",
  "how_it_works": "Key features and core user experience flow",
  "growth_strategy": "How users discover and share this product -- specific viral mechanics and channels",
  "build_suggestions": "Recommended tech approach, MVP scope, and first 3 steps to validate"
}`;

const parseDeepDiveJson = (text: string): DeepDiveResult | null => {
  const parsed = parseJsonObject(text);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const row = parsed as Record<string, unknown>;
  const summary = typeof row.summary === 'string' ? row.summary.trim() : '';
  const howItWorks = typeof row.how_it_works === 'string' ? row.how_it_works.trim() : '';
  const growthStrategy = typeof row.growth_strategy === 'string' ? row.growth_strategy.trim() : '';
  const buildSuggestions = typeof row.build_suggestions === 'string' ? row.build_suggestions.trim() : '';

  if (!summary || !howItWorks || !growthStrategy || !buildSuggestions) {
    return null;
  }

  return { summary, howItWorks, growthStrategy, buildSuggestions };
};

const noopLog = { info: async () => {}, warn: async () => {}, debug: async () => {}, error: async () => {} };

export const generateDeepDive = async (
  input: DeepDiveInput,
  deps: DeepDiveGeneratorDeps
): Promise<{ result: DeepDiveResult; provider: string }> => {
  const { runClaude, runCodex, preferredProvider = 'claude', allowFallback = true, logger } = deps;
  const log = logger ?? noopLog;
  const prompt = buildPrompt(input);
  const promptInput: RunPromptInput = { prompt, timeoutMs: TIMEOUT_MS };

  const primaryRun = preferredProvider === 'codex' ? runCodex : runClaude;
  const fallbackRun = preferredProvider === 'codex' ? runClaude : runCodex;
  const primaryName = preferredProvider === 'codex' ? 'codex' : 'claude';
  const fallbackName = preferredProvider === 'codex' ? 'claude' : 'codex';

  await log.info('deep_dive', 'generating deep-dive', {
    thesis: input.title,
    provider: primaryName
  });

  const startMs = Date.now();

  let primaryResult: RunPromptResult;
  try {
    primaryResult = await primaryRun(promptInput);
    const parsed = parseDeepDiveJson(primaryResult.text);
    if (parsed) {
      await log.info('deep_dive', 'deep-dive complete', {
        thesis: input.title,
        provider: primaryResult.provider,
        duration_ms: Date.now() - startMs
      });
      return { result: parsed, provider: primaryResult.provider };
    }
    await log.warn('deep_dive', 'primary parse failed', {
      thesis: input.title, provider: primaryName
    });
  } catch (err) {
    await log.warn('deep_dive', 'primary provider failed', {
      thesis: input.title, provider: primaryName,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  if (!allowFallback) {
    throw new Error(`deep_dive_generator: ${primaryName} failed and fallback is disabled`);
  }

  const fallbackResult = await fallbackRun(promptInput);
  const parsed = parseDeepDiveJson(fallbackResult.text);
  if (!parsed) {
    await log.error('deep_dive', 'deep-dive failed', {
      thesis: input.title,
      providers: `${primaryName}+${fallbackName}`,
      duration_ms: Date.now() - startMs
    });
    throw new Error(
      `deep_dive_generator: failed to parse AI response from both providers. Preview: ${fallbackResult.text.slice(0, 200)}`
    );
  }

  await log.info('deep_dive', 'deep-dive complete (fallback)', {
    thesis: input.title,
    provider: fallbackResult.provider,
    duration_ms: Date.now() - startMs
  });
  return { result: parsed, provider: fallbackResult.provider };
};
