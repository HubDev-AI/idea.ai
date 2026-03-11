import type { ConnectorStatusRecord, RefreshMeta } from '@idea/contracts/src/api';
import type { FastifyInstance } from 'fastify';
import type { ExecutionLogger } from '../runtime/execution_logger';
import type { PostgresSignalStore } from '../runtime/postgres_signal_store';

export type { ConnectorStatusRecord, RefreshMeta } from '@idea/contracts/src/api';

export const registerConnectorRoute = (
  app: FastifyInstance,
  deps: {
    listConnectors: () => Promise<ConnectorStatusRecord[]>;
    signalStore?: PostgresSignalStore | null;
    getRefreshMeta?: () => RefreshMeta;
    triggerRefresh?: (cadence?: 'hourly' | 'daily') => Promise<void>;
    logger?: Pick<ExecutionLogger, 'info'>;
  }
): void => {
  app.get('/v1/connectors', async () => deps.listConnectors());

  app.get('/v1/signals/counts', async () => {
    if (!deps.signalStore) {
      return {};
    }
    return deps.signalStore.countSignalsBySource();
  });

  app.get('/v1/connectors/refresh-meta', async () => {
    if (!deps.getRefreshMeta) {
      return {
        last_hourly_run: null,
        last_daily_run: null,
        hourly_interval_ms: 3600000,
        daily_interval_ms: 86400000,
        refreshing: { hourly: false, daily: false }
      };
    }
    return deps.getRefreshMeta();
  });

  app.post<{ Querystring: { cadence?: string } }>('/v1/connectors/refresh', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { querystring: { type: 'object', properties: { cadence: { type: 'string', enum: ['hourly', 'daily'] } } } }
  }, async (request) => {
    if (!deps.triggerRefresh) {
      return { status: 'unavailable' };
    }
    const cadence = request.query.cadence as 'hourly' | 'daily' | undefined;
    await deps.logger?.info('connectors', 'manual refresh triggered', {
      cadence: cadence ?? 'all'
    });
    void deps.triggerRefresh(cadence);
    return { status: 'triggered' };
  });
};
