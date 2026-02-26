import Fastify, { type FastifyInstance } from 'fastify';
import { registerAiHealthRoute, type AiHealthRecord } from './routes/ai_health';
import { registerConnectorRoute, type ConnectorStatusRecord } from './routes/connectors';
import { registerFeedRoute, type FeedRecord } from './routes/feed';
import { registerHealthRoute } from './routes/health';
import { registerLogsRoute, type ExecutionLogRecord, type ListLogsQuery } from './routes/logs';
import { registerThesesRoute } from './routes/theses';
import type { PostgresMemoryStore } from './runtime/postgres_memory_store';
import type { ThesisStore } from './runtime/thesis_store';

export type ServerDeps = {
  listSignals: () => Promise<FeedRecord[]>;
  listConnectors: () => Promise<ConnectorStatusRecord[]>;
  listLogs: (query: ListLogsQuery) => Promise<ExecutionLogRecord[]>;
  getAiHealth: () => Promise<AiHealthRecord>;
  thesisStore?: ThesisStore;
  memoryStore?: PostgresMemoryStore | null;
  corsOrigins?: string[];
};

const defaultDeps: ServerDeps = {
  listSignals: async () => [],
  listConnectors: async () => [],
  listLogs: async () => [],
  getAiHealth: async () => ({
    run_id: null,
    refreshed_at: null,
    provider_setting: 'claude',
    judge_mode: 'single',
    fallback_enabled: false,
    retry_budget: 0,
    post_scrape_enabled: false,
    post_scrape_max_signals: 0,
    judge_max_signals: 0,
    providers: [
      {
        provider: 'claude',
        enabled: true,
        status: 'idle',
        attempted: 0,
        succeeded: 0,
        failed: 0,
        retries: 0,
        last_error: null
      },
      {
        provider: 'codex',
        enabled: false,
        status: 'disabled',
        attempted: 0,
        succeeded: 0,
        failed: 0,
        retries: 0,
        last_error: null
      }
    ]
  })
};

export const buildServer = (deps: Partial<ServerDeps> = {}): FastifyInstance => {
  const app = Fastify({ logger: false });
  const resolvedDeps: ServerDeps = {
    ...defaultDeps,
    ...deps
  };

  const allowedOrigins = new Set(resolvedDeps.corsOrigins ?? []);
  const openCors = allowedOrigins.size === 0;

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;

    if (origin && (openCors || allowedOrigins.has(origin))) {
      reply.header('Access-Control-Allow-Origin', origin);
    }
    reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type,X-Api-Key');
    reply.header('Vary', 'Origin');

    if (request.method === 'OPTIONS') {
      reply.code(204).send();
    }
  });

  registerFeedRoute(app, { listSignals: resolvedDeps.listSignals });
  registerConnectorRoute(app, { listConnectors: resolvedDeps.listConnectors });
  registerLogsRoute(app, { listLogs: resolvedDeps.listLogs });
  registerAiHealthRoute(app, { getAiHealth: resolvedDeps.getAiHealth });
  registerHealthRoute(app);

  if (resolvedDeps.thesisStore) {
    registerThesesRoute(app, {
      store: resolvedDeps.thesisStore,
      memoryStore: resolvedDeps.memoryStore ?? null
    });
  }

  return app;
};
