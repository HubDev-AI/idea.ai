import type { AiHealthRecord, } from '@idea/contracts/src/api';
import type { RouterStats } from '@idea/ai-runtime/src/router';
import type { FastifyInstance } from 'fastify';

export type { AiHealthRecord, AiProviderHealthRecord, AiProviderName, AiProviderStatus } from '@idea/contracts/src/api';

export const registerAiHealthRoute = (
  app: FastifyInstance,
  deps: {
    getAiHealth: () => Promise<AiHealthRecord>;
    getRouterStats?: () => { stats: RouterStats; enabled: boolean } | null;
  }
): void => {
  app.get('/v1/ai-health', async () => {
    const health = await deps.getAiHealth();
    if (deps.getRouterStats) {
      const routerData = deps.getRouterStats();
      if (routerData) {
        health.routerStats = {
          ollamaCalls: routerData.stats.ollamaCalls,
          ollamaSucceeded: routerData.stats.ollamaSucceeded,
          cliCalls: routerData.stats.cliCalls,
          cliSucceeded: routerData.stats.cliSucceeded,
          fallbacks: routerData.stats.fallbacks,
          routingEnabled: routerData.enabled,
        };
      }
    }
    return health;
  });
};
