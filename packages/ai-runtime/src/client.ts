import { runClaudePrompt } from './claude';
import { runCodexPrompt } from './codex';
import type { Provider, RunPromptInput, RunPromptResult } from './types';

const shouldFallback = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return true;
  }

  const code = (error as Error & { code?: string }).code;

  return code === 'ETIMEDOUT' || code === 'ECLAUDE_NON_ZERO' || code === 'ECODEX_NON_ZERO' || !code;
};

export const runPrompt = async (
  input: RunPromptInput,
  deps: {
    runClaude?: (input: RunPromptInput) => Promise<RunPromptResult>;
    runCodex?: (input: RunPromptInput) => Promise<RunPromptResult>;
  } = {}
): Promise<RunPromptResult> => {
  const preferredProvider: Provider = input.preferredProvider ?? 'claude';
  const runClaude = deps.runClaude ?? runClaudePrompt;
  const runCodex = deps.runCodex ?? runCodexPrompt;

  if (preferredProvider === 'codex') {
    try {
      return await runCodex(input);
    } catch (error) {
      if (!shouldFallback(error)) {
        throw error;
      }

      return runClaude(input);
    }
  }

  try {
    return await runClaude(input);
  } catch (error) {
    if (!shouldFallback(error)) {
      throw error;
    }

    return runCodex(input);
  }
};
