import type { OllamaPromptOptions } from './ollama_prompt';
import type { RunPromptInput, RunPromptResult } from './types';

export type ModelTier = 'cheap' | 'medium' | 'expensive';

type TaskRoute = {
  tier: ModelTier;
  ollamaModel?: string;
  fallbackToCli?: boolean;
};

export const TASK_ROUTES: Record<string, TaskRoute> = {
  noise_classification: { tier: 'cheap', ollamaModel: 'cheap' },
  dedup_check: { tier: 'cheap', ollamaModel: 'cheap' },
  entity_extraction: { tier: 'cheap', ollamaModel: 'cheap' },
  basic_scoring: { tier: 'medium', ollamaModel: 'medium', fallbackToCli: true },
  thesis_synthesis: { tier: 'expensive' },
  debate: { tier: 'expensive' },
  deep_dive: { tier: 'expensive' },
};

export type RouterDeps = {
  runOllama: (prompt: string, options: OllamaPromptOptions) => Promise<string>;
  runCli: (input: RunPromptInput) => Promise<RunPromptResult>;
  ollamaCheapModel: string;
  ollamaMediumModel: string;
  ollamaBaseUrl: string;
  ollamaTimeoutMs: number;
};

export type Router = {
  route: (task: string, prompt: string) => Promise<string>;
};

export const createRouter = (deps: RouterDeps): Router => ({
  route: async (task: string, prompt: string): Promise<string> => {
    const route = TASK_ROUTES[task];
    if (!route || route.tier === 'expensive') {
      const result = await deps.runCli({ prompt });
      return result.text;
    }

    const model = route.ollamaModel === 'cheap' ? deps.ollamaCheapModel : deps.ollamaMediumModel;

    try {
      return await deps.runOllama(prompt, {
        model,
        baseUrl: deps.ollamaBaseUrl,
        timeoutMs: deps.ollamaTimeoutMs,
      });
    } catch (err) {
      if (route.fallbackToCli) {
        const result = await deps.runCli({ prompt });
        return result.text;
      }
      throw err;
    }
  },
});
