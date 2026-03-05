import type { ConnectorStatusRecord, RefreshMeta } from '@idea/contracts/src/api';
import type { FastifyInstance } from 'fastify';
import type { PostgresMemoryStore } from '../runtime/postgres_memory_store';

export type { ConnectorStatusRecord, RefreshMeta } from '@idea/contracts/src/api';

export const registerConnectorRoute = (
  app: FastifyInstance,
  deps: {
    listConnectors: () => Promise<ConnectorStatusRecord[]>;
    memoryStore?: PostgresMemoryStore | null;
    getRefreshMeta?: () => RefreshMeta;
    triggerRefresh?: () => Promise<void>;
  }
): void => {
  app.get('/v1/connectors', async () => deps.listConnectors());

  app.get('/v1/signals/counts', async () => {
    if (!deps.memoryStore) {
      return {};
    }
    return deps.memoryStore.countSignalsBySource();
  });

  app.get('/v1/connectors/refresh-meta', async () => {
    if (!deps.getRefreshMeta) {
      return { last_hourly_run: null, last_daily_run: null, hourly_interval_ms: 3600000, daily_interval_ms: 86400000 };
    }
    return deps.getRefreshMeta();
  });

  app.post('/v1/connectors/refresh', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async () => {
    if (!deps.triggerRefresh) {
      return { status: 'unavailable' };
    }
    void deps.triggerRefresh();
    return { status: 'triggered' };
  });
};
