import type { InfraStatusRecord } from '@idea/contracts/src/api';
import type { FastifyInstance } from 'fastify';

export type InfraStatusDeps = {
  checkPostgres: () => Promise<boolean>;
  checkOllama: () => Promise<boolean>;
  getEmbeddingStats: () => Promise<{ total: number; withEmbedding: number; fallbackModel: string }>;
};

export const registerInfraStatusRoute = (
  app: FastifyInstance,
  deps: InfraStatusDeps
): void => {
  app.get('/v1/infra/status', async (): Promise<InfraStatusRecord> => {
    const [pgOk, ollamaOk, embStats] = await Promise.all([
      deps.checkPostgres().catch(() => false),
      deps.checkOllama().catch(() => false),
      deps.getEmbeddingStats().catch(() => ({ total: 0, withEmbedding: 0, fallbackModel: 'unknown' }))
    ]);

    return {
      postgres: pgOk ? 'ok' : 'error',
      ollama: ollamaOk ? 'ok' : 'error',
      embeddings: embStats
    };
  });
};
