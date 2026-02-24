import type { FastifyInstance } from 'fastify';

export type FeedRecord = {
  idea: string;
  score: number;
  top_source: string;
  snippet: string;
  next_action: 'validate_demand' | 'validate_pricing' | 'validate_channel';
  updated_at: string;
};

export const registerFeedRoute = (
  app: FastifyInstance,
  deps: { listSignals: () => Promise<FeedRecord[]> }
): void => {
  app.get('/v1/signals', async () => deps.listSignals());
};
