import rateLimit from '@fastify/rate-limit';
import type { AgentStatusRecord, RefreshMeta } from '@idea/contracts/src/api';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AgentRunResult } from './jobs/agent_runner';
import type { DeepDiveGeneratorDeps } from './jobs/deep_dive_generator';
import { registerAgentStatusRoute } from './routes/agent_status';
import { type AiHealthRecord, registerAiHealthRoute } from './routes/ai_health';
import { type ConnectorStatusRecord, registerConnectorRoute } from './routes/connectors';
import { type FeedRecord, registerFeedRoute } from './routes/feed';
import { registerHealthRoute } from './routes/health';
import { type InfraStatusDeps, registerInfraStatusRoute } from './routes/infra_status';
import { type ExecutionLogRecord, type ListLogsQuery, registerLogsRoute } from './routes/logs';
import { registerOpportunityMapRoute } from './routes/opportunity_map';
import { registerProfilesRoute } from './routes/profiles.js';
import { registerScoringHealthRoute } from './routes/scoring_health';
import { getActiveWeights } from './runtime/active_weights';
import { registerThesesRoute } from './routes/theses';
import { registerThesisExplainRoute } from './routes/thesis_explain';
import type { AgentRunStore } from './runtime/agent_run_store';
import type { DeepDiveStore } from './runtime/deep_dive_store';
import type { ExecutionLogger } from './runtime/execution_logger';
import type { PostgresMemoryStore } from './runtime/postgres_memory_store';
import type { ThesisStore } from './runtime/thesis_store';

export type ServerDeps = {
  listSignals: () => Promise<FeedRecord[]>;
  listConnectors: () => Promise<ConnectorStatusRecord[]>;
  listLogs: (query: ListLogsQuery) => Promise<ExecutionLogRecord[]>;
  getAiHealth: () => Promise<AiHealthRecord>;
  thesisStore?: ThesisStore;
  memoryStore?: PostgresMemoryStore | null;
  deepDiveStore?: DeepDiveStore | null;
  deepDiveAi?: DeepDiveGeneratorDeps | null;
  corsOrigins?: string[];
  apiKey?: string;
  rateLimitMax?: number;
  getAgentStatus?: () => AgentStatusRecord;
  triggerAgentRun?: () => Promise<AgentRunResult>;
  agentRunStore?: AgentRunStore | null;
  infraStatusDeps?: InfraStatusDeps;
  getRefreshMeta?: () => RefreshMeta;
  triggerRefresh?: (cadence?: 'hourly' | 'daily') => Promise<void>;
  logger?: ExecutionLogger;
  pool?: import('pg').Pool;
};

const defaultDeps: ServerDeps = {
  listSignals: async () => [],
  listConnectors: async () => [],
  listLogs: async () => [],
  getAiHealth: async () => ({
    run_id: null,
    refreshed_at: null,
    provider_setting: 'claude',
    primary_provider: 'claude',
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
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
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

  const rateLimitMax = resolvedDeps.rateLimitMax ?? 10_000;
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
    memoryStore: resolvedDeps.memoryStore ?? null,
    getRefreshMeta: resolvedDeps.getRefreshMeta,
    triggerRefresh: resolvedDeps.triggerRefresh,
    logger: resolvedDeps.logger
  });
  registerLogsRoute(app, { listLogs: resolvedDeps.listLogs });
  registerAiHealthRoute(app, { getAiHealth: resolvedDeps.getAiHealth });
  registerHealthRoute(app);
  registerProfilesRoute(app);

  if (resolvedDeps.getAgentStatus && resolvedDeps.triggerAgentRun) {
    registerAgentStatusRoute(app, {
      getAgentStatus: resolvedDeps.getAgentStatus,
      triggerRun: resolvedDeps.triggerAgentRun,
      agentRunStore: resolvedDeps.agentRunStore ?? null
    });
  }

  if (resolvedDeps.thesisStore) {
    registerThesesRoute(app, {
      store: resolvedDeps.thesisStore,
      memoryStore: resolvedDeps.memoryStore ?? null,
      deepDiveStore: resolvedDeps.deepDiveStore ?? null,
      deepDiveAi: resolvedDeps.deepDiveAi ?? null,
      logger: resolvedDeps.logger
    });
    registerThesisExplainRoute(app, {
      store: resolvedDeps.thesisStore,
      pool: resolvedDeps.pool ?? null,
    });
  }

  if (resolvedDeps.pool) {
    registerOpportunityMapRoute(app, { pool: resolvedDeps.pool });
    registerScoringHealthRoute(app, {
      pool: resolvedDeps.pool,
      getActiveWeights: (profileId) => getActiveWeights(resolvedDeps.pool!, profileId),
    });
  }

  if (resolvedDeps.infraStatusDeps) {
    registerInfraStatusRoute(app, {
      ...resolvedDeps.infraStatusDeps,
      ...(resolvedDeps.logger ? { logger: resolvedDeps.logger } : {})
    });
  }

  return app;
};
