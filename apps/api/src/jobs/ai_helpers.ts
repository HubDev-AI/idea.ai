import { runClaudePrompt } from '@idea/ai-runtime/src/claude';
import { runCodexPrompt } from '@idea/ai-runtime/src/codex';
import type { Provider, RunPromptInput, RunPromptResult } from '@idea/ai-runtime/src/types';

export const clampScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

export const clampConfidence = (value: number): number => Math.max(0, Math.min(1, value));

export const toPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
};

export const stripMarkdownFences = (text: string): string => {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  return fenceMatch?.[1] ? fenceMatch[1].trim() : text;
};

export const parseJsonObject = (text: string): unknown => {
  const trimmed = stripMarkdownFences(text.trim());
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

export const otherProvider = (provider: Provider): Provider => (provider === 'codex' ? 'claude' : 'codex');

export const resolvePreferredProvider = (env: NodeJS.ProcessEnv): Provider => {
  const raw = env.AI_PROVIDER?.toLowerCase();
  if (raw === 'both') {
    return env.AI_PROVIDER_PRIMARY?.toLowerCase() === 'codex' ? 'codex' : 'claude';
  }
  return raw === 'codex' ? 'codex' : 'claude';
};

export const runProvider = async (
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
