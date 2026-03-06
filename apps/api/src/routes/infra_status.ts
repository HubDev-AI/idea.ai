import type { InfraStatusRecord } from '@idea/contracts/src/api';
import type { FastifyInstance } from 'fastify';
import type { ExecutionLogger } from '../runtime/execution_logger';

export type OllamaCheckResult = { ok: boolean; reason?: string; sizeMb?: number };

export type InfraStatusDeps = {
  checkPostgres: () => Promise<boolean>;
  checkOllama: () => Promise<OllamaCheckResult>;
  getEmbeddingStats: () => Promise<{ total: number; withEmbedding: number; fallbackModel: string }>;
  getDiskStats?: () => Promise<{ dbSizeMb: number; tableSizes: { name: string; sizeMb: number; rows: number }[] }>;
  logger?: Pick<ExecutionLogger, 'info' | 'warn' | 'error'>;
};

export const registerInfraStatusRoute = (
  app: FastifyInstance,
  deps: InfraStatusDeps
): void => {
  let lastLoggedAt = 0;
  const LOG_INTERVAL_MS = 5 * 60 * 1000; // log at most every 5 minutes

  app.get('/v1/infra/status', async (): Promise<InfraStatusRecord> => {
    const [pgResult, ollamaResult, embStats, diskResult] = await Promise.allSettled([
      deps.checkPostgres(),
      deps.checkOllama(),
      deps.getEmbeddingStats(),
      deps.getDiskStats?.() ?? Promise.resolve(null)
    ]);

    const pgOk = pgResult.status === 'fulfilled' && pgResult.value;
    const ollamaCheck = ollamaResult.status === 'fulfilled' ? ollamaResult.value : { ok: false, reason: 'check failed' };
    const ollamaOk = ollamaCheck.ok;
    const emb = embStats.status === 'fulfilled'
      ? embStats.value
      : { total: 0, withEmbedding: 0, fallbackModel: 'unknown' };

    const now = Date.now();
    const shouldLog = now - lastLoggedAt >= LOG_INTERVAL_MS;

    if (shouldLog && deps.logger) {
      lastLoggedAt = now;

      if (!pgOk) {
        const err = pgResult.status === 'rejected' ? pgResult.reason : null;
        await deps.logger.error('infra', 'postgres unreachable', {
          error: err instanceof Error ? err.message : String(err ?? 'check returned false')
        });
      }

      if (!ollamaOk) {
        await deps.logger.warn('infra', 'ollama not ready', {
          reason: ollamaCheck.reason ?? 'unknown'
        });
      }

      if (emb.total > 0 && emb.withEmbedding < emb.total) {
        const coverage = Math.round(emb.withEmbedding / emb.total * 100);
        await deps.logger.warn('infra', 'embedding coverage incomplete', {
          with_embedding: emb.withEmbedding,
          total: emb.total,
          coverage_pct: coverage,
          fallback_model: emb.fallbackModel
        });
      }

      if (pgOk && ollamaOk && emb.withEmbedding === emb.total) {
        await deps.logger.info('infra', 'all systems healthy', {
          postgres: 'ok',
          ollama: 'ok',
          embeddings: `${emb.withEmbedding}/${emb.total}`
        });
      }
    }

    const disk = diskResult.status === 'fulfilled' && diskResult.value ? diskResult.value : undefined;

    return {
      postgres: pgOk ? 'ok' : 'error',
      ollama: ollamaOk ? 'ok' : 'error',
      ...(ollamaCheck.sizeMb != null ? { ollamaSizeMb: ollamaCheck.sizeMb } : {}),
      embeddings: emb,
      ...(disk ? { diskUsage: disk } : {})
    };
  });
};
