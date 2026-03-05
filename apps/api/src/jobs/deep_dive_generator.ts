import type { RunPromptInput, RunPromptResult } from '@idea/ai-runtime/src/types';

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

const stripMarkdownFences = (text: string): string => {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  return fenceMatch?.[1] ? fenceMatch[1].trim() : text;
};

const parseDeepDiveJson = (text: string): DeepDiveResult | null => {
  const trimmed = stripMarkdownFences(text.trim());
  if (!trimmed) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

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

export const generateDeepDive = async (
  input: DeepDiveInput,
  deps: DeepDiveGeneratorDeps
): Promise<{ result: DeepDiveResult; provider: string }> => {
  const { runClaude, runCodex, preferredProvider = 'claude' } = deps;
  const prompt = buildPrompt(input);
  const promptInput: RunPromptInput = { prompt, timeoutMs: TIMEOUT_MS };

  const primaryRun = preferredProvider === 'codex' ? runCodex : runClaude;
  const fallbackRun = preferredProvider === 'codex' ? runClaude : runCodex;

  let primaryResult: RunPromptResult;
  try {
    primaryResult = await primaryRun(promptInput);
    const parsed = parseDeepDiveJson(primaryResult.text);
    if (parsed) {
      return { result: parsed, provider: primaryResult.provider };
    }
  } catch {
    // fall through to fallback
  }

  const fallbackResult = await fallbackRun(promptInput);
  const parsed = parseDeepDiveJson(fallbackResult.text);
  if (!parsed) {
    throw new Error(
      `deep_dive_generator: failed to parse AI response from both providers. Preview: ${fallbackResult.text.slice(0, 200)}`
    );
  }

  return { result: parsed, provider: fallbackResult.provider };
};
