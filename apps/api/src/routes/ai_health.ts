import type { AiHealthRecord, } from '@idea/contracts/src/api';
import type { FastifyInstance } from 'fastify';

export type { AiHealthRecord, AiProviderHealthRecord, AiProviderName, AiProviderStatus } from '@idea/contracts/src/api';

export const registerAiHealthRoute = (
  app: FastifyInstance,
  deps: { getAiHealth: () => Promise<AiHealthRecord> }
): void => {
  app.get('/v1/ai-health', async () => deps.getAiHealth());
};
