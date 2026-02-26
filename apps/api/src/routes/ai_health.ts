import type { FastifyInstance } from 'fastify';
import type { AiHealthRecord, AiProviderHealthRecord } from '@idea/contracts/src/api';

export type { AiProviderName, AiProviderStatus, AiProviderHealthRecord, AiHealthRecord } from '@idea/contracts/src/api';

export const registerAiHealthRoute = (
  app: FastifyInstance,
  deps: { getAiHealth: () => Promise<AiHealthRecord> }
): void => {
  app.get('/v1/ai-health', async () => deps.getAiHealth());
};
