import type { ConnectorStatusRecord } from '@idea/contracts/src/api';
import type { FastifyInstance } from 'fastify';
import type { PostgresMemoryStore } from '../runtime/postgres_memory_store';

export type { ConnectorStatusRecord } from '@idea/contracts/src/api';

export const registerConnectorRoute = (
  app: FastifyInstance,
  deps: {
    listConnectors: () => Promise<ConnectorStatusRecord[]>;
    memoryStore?: PostgresMemoryStore | null;
  }
): void => {
  app.get('/v1/connectors', async () => deps.listConnectors());

  app.get('/v1/signals/counts', async () => {
    if (!deps.memoryStore) {
      return {};
    }
    return deps.memoryStore.countSignalsBySource();
  });
};
