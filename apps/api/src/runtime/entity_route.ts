import { runClaudePrompt } from '@idea/ai-runtime/src/claude';
import { runCodexPrompt } from '@idea/ai-runtime/src/codex';
import type { Provider, RunPromptInput, RunPromptResult } from '@idea/ai-runtime/src/types';
import { resolveFallbackProvider, resolvePreferredProvider, toPositiveInt } from '../jobs/ai_helpers';

type EntityRouteDeps = {
  env?: NodeJS.ProcessEnv;
  modelRouter?: { route: (task: string, prompt: string) => Promise<string> } | null;
  runClaude?: (input: RunPromptInput) => Promise<RunPromptResult>;
  runCodex?: (input: RunPromptInput) => Promise<RunPromptResult>;
};

const runSingleProvider = async (
  provider: Provider,
  prompt: string,
  timeoutMs: number,
  deps: Pick<EntityRouteDeps, 'runClaude' | 'runCodex'>
): Promise<string> => {
  const input: RunPromptInput = {
    prompt,
    timeoutMs,
    preferredProvider: provider
  };

  if (provider === 'codex') {
    const result = await (deps.runCodex ?? runCodexPrompt)(input);
    return result.text;
  }

  const result = await (deps.runClaude ?? runClaudePrompt)(input);
  return result.text;
};

export const createEntityRoute = (deps: EntityRouteDeps = {}): ((task: string, prompt: string) => Promise<string>) => {
  if (deps.modelRouter) {
    return deps.modelRouter.route;
  }

  const env = deps.env ?? process.env;
  const preferredProvider = resolvePreferredProvider(env);
  const fallbackProvider = resolveFallbackProvider(env);
  const timeoutMs = toPositiveInt(env.AI_TIMEOUT_MS, 300_000);

  return async (_task: string, prompt: string): Promise<string> => {
    try {
      return await runSingleProvider(preferredProvider, prompt, timeoutMs, deps);
    } catch (error) {
      if (!fallbackProvider) {
        throw error;
      }

      return runSingleProvider(fallbackProvider, prompt, timeoutMs, deps);
    }
  };
};
