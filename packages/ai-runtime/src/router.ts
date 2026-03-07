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

export type RouterStats = {
  ollamaCalls: number;
  ollamaSucceeded: number;
  ollamaFailed: number;
  cliCalls: number;
  cliSucceeded: number;
  cliFailed: number;
  fallbacks: number;
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
  getStats: () => RouterStats;
  resetStats: () => void;
};

export const createRouter = (deps: RouterDeps): Router => {
  const stats: RouterStats = {
    ollamaCalls: 0,
    ollamaSucceeded: 0,
    ollamaFailed: 0,
    cliCalls: 0,
    cliSucceeded: 0,
    cliFailed: 0,
    fallbacks: 0,
  };

  return {
    route: async (task: string, prompt: string): Promise<string> => {
      const route = TASK_ROUTES[task];
      if (!route || route.tier === 'expensive') {
        stats.cliCalls++;
        try {
          const result = await deps.runCli({ prompt });
          stats.cliSucceeded++;
          return result.text;
        } catch (err) {
          stats.cliFailed++;
          throw err;
        }
      }

      const model = route.ollamaModel === 'cheap' ? deps.ollamaCheapModel : deps.ollamaMediumModel;

      stats.ollamaCalls++;
      try {
        const result = await deps.runOllama(prompt, {
          model,
          baseUrl: deps.ollamaBaseUrl,
          timeoutMs: deps.ollamaTimeoutMs,
        });
        stats.ollamaSucceeded++;
        return result;
      } catch (err) {
        stats.ollamaFailed++;
        if (route.fallbackToCli) {
          stats.fallbacks++;
          stats.cliCalls++;
          try {
            const result = await deps.runCli({ prompt });
            stats.cliSucceeded++;
            return result.text;
          } catch (cliErr) {
            stats.cliFailed++;
            throw cliErr;
          }
        }
        throw err;
      }
    },

    getStats: () => ({ ...stats }),

    resetStats: () => {
      stats.ollamaCalls = 0;
      stats.ollamaSucceeded = 0;
      stats.ollamaFailed = 0;
      stats.cliCalls = 0;
      stats.cliSucceeded = 0;
      stats.cliFailed = 0;
      stats.fallbacks = 0;
    },
  };
};
