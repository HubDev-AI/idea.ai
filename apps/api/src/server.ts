import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { type AiHealthRecord, registerAiHealthRoute } from './routes/ai_health';
import { type ConnectorStatusRecord, registerConnectorRoute } from './routes/connectors';
import { type FeedRecord, registerFeedRoute } from './routes/feed';
import { registerHealthRoute } from './routes/health';
import { type ExecutionLogRecord, type ListLogsQuery, registerLogsRoute } from './routes/logs';
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
  apiKey?: string;
  rateLimitMax?: number;
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

export const buildServer = async (deps: Partial<ServerDeps> = {}): Promise<FastifyInstance> => {
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

  const apiKey = resolvedDeps.apiKey;
  if (apiKey) {
    app.addHook('onRequest', async (request, reply) => {
      if (request.method === 'OPTIONS') return;
      if (request.url === '/health') return;
      const provided = request.headers['x-api-key'];
      if (provided !== apiKey) {
        reply.code(401).send({ error: 'Unauthorized' });
      }
    });
  }

  const rateLimitMax = resolvedDeps.rateLimitMax ?? 100;
  await app.register(rateLimit, {
    max: rateLimitMax,
    timeWindow: '1 minute'
  });

  const feedDeps: Parameters<typeof registerFeedRoute>[1] = {
    listSignals: resolvedDeps.listSignals
  };
  if (resolvedDeps.memoryStore != null) feedDeps.memoryStore = resolvedDeps.memoryStore;
  registerFeedRoute(app, feedDeps);
  registerConnectorRoute(app, {
    listConnectors: resolvedDeps.listConnectors,
    memoryStore: resolvedDeps.memoryStore ?? null
  });
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
