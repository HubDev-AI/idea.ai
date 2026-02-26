import type { ConnectorStatusRecord } from '@idea/contracts/src/api';
import type { FastifyInstance } from 'fastify';

export type { ConnectorStatusRecord } from '@idea/contracts/src/api';

export const registerConnectorRoute = (
  app: FastifyInstance,
  deps: { listConnectors: () => Promise<ConnectorStatusRecord[]> }
): void => {
  app.get('/v1/connectors', async () => deps.listConnectors());
};
