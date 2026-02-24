import Fastify, { type FastifyInstance } from 'fastify';
import { registerConnectorRoute, type ConnectorStatusRecord } from './routes/connectors';
import { registerFeedRoute, type FeedRecord } from './routes/feed';
import { registerHealthRoute } from './routes/health';

export type ServerDeps = {
  listSignals: () => Promise<FeedRecord[]>;
  listConnectors: () => Promise<ConnectorStatusRecord[]>;
};

const defaultDeps: ServerDeps = {
  listSignals: async () => [],
  listConnectors: async () => []
};

export const buildServer = (deps: Partial<ServerDeps> = {}): FastifyInstance => {
  const app = Fastify({ logger: false });
  const resolvedDeps: ServerDeps = {
    ...defaultDeps,
    ...deps
  };

  registerFeedRoute(app, { listSignals: resolvedDeps.listSignals });
  registerConnectorRoute(app, { listConnectors: resolvedDeps.listConnectors });
  registerHealthRoute(app);

  return app;
};
