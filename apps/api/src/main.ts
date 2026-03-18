import { runClaudePrompt } from '@idea/ai-runtime/src/claude';
import { runCodexPrompt } from '@idea/ai-runtime/src/codex';
import { embedText } from '@idea/ai-runtime/src/ollama';
import { runOllamaPrompt } from '@idea/ai-runtime/src/ollama_prompt';
import { createRouter } from '@idea/ai-runtime/src/router';
import type { AgentRunAccepted, AgentStatusRecord } from '@idea/contracts/src/api';
import type { ClientToServerEvents, ServerToClientEvents } from '@idea/contracts/src/ws';
import pg from 'pg';
import { Server as SocketIOServer } from 'socket.io';
import { loadEnvFile } from './config/dotenv';
import { loadRuntimeEnv } from './config/env';
import { aggregateAgentProfileRuns } from './jobs/agent_run_aggregation';
import { type AgentRunResult, runResearchAgent } from './jobs/agent_runner';
import { extractEntities } from './jobs/entity_extractor';
import { snapshotPredictions } from './jobs/backtest_snapshot';
import { validatePredictions } from './jobs/backtest_validate';

import { runWeightOptimization } from './jobs/weight_optimizer_job';
import { loadProfiles } from './profiles/index.js';
import { type AgentRunStore, createAgentRunStore } from './runtime/agent_run_store';
import { createByoSpendStore } from './runtime/byo_spend_store';
import { createDeepDiveStore } from './runtime/deep_dive_store';
import { createEntityStore } from './runtime/entity_store';
import { createExecutionLogger } from './runtime/execution_logger';
import { createExperienceStore } from './runtime/experience_store';
import { createPostgresJournalStore } from './runtime/journal_store';
import { buildShutdownInterruptedError, isAgentCatchUpDue } from './runtime/agent_run_lifecycle';
import { createLiveReadModel } from './runtime/live_read_model';
import { createPostgresSignalStore } from './runtime/postgres_signal_store';
import { buildStartupAgentStatus } from './runtime/agent_status_state';
import { createPostgresThesisStore, type PaginatedThesisStore } from './runtime/postgres_thesis_store';
import { createProviderCircuitBreaker } from './runtime/provider_circuit';
import { InMemoryThesisStore } from './runtime/thesis_store';
import { buildServer, type ServerDeps } from './server';
import { StateHub } from './ws/state_hub';

loadEnvFile();

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);
const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const apiKey = process.env.API_KEY || undefined;
if (!apiKey && host !== '127.0.0.1' && host !== 'localhost') {
  console.error(
    `[startup] ERROR: API_KEY is not set but HOST=${host} is not localhost. ` +
    `Set API_KEY or bind to 127.0.0.1 for local-only mode.`
  );
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;

const startupEnv = loadRuntimeEnv(process.env);
const providerCircuit = createProviderCircuitBreaker({
  threshold: startupEnv.circuitBreakerThreshold,
  cooldownMs: startupEnv.circuitBreakerCooldownMs,
});
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl, max: 4 }) : null;
const byoSpendStore = pool ? createByoSpendStore({ pool }) : null;

const thesisStore = pool
  ? createPostgresThesisStore({ pool })
  : new InMemoryThesisStore();

const embedTextFn = (text: string) => embedText(text, { fallbackToNull: true });

const signalStore = databaseUrl
  ? createPostgresSignalStore({ databaseUrl, embedText: embedTextFn })
  : null;

const readModel = createLiveReadModel(startupEnv.connectorRefreshMs, {
  ...(signalStore ? { persistentStore: signalStore } : {}),
  circuit: providerCircuit,
  ...(pool ? { pool } : {}),
  ...(byoSpendStore ? { byoSpendStore } : {}),
});

const journalStore = databaseUrl
  ? createPostgresJournalStore({ databaseUrl })
  : null;

const agentRunStore: AgentRunStore | null = pool
  ? createAgentRunStore({ pool })
  : null;

const experienceStore = pool ? createExperienceStore({ pool }) : null;
const entityStore = pool ? createEntityStore({ pool }) : null;

const modelRouter = startupEnv.modelRoutingEnabled
  ? createRouter({
      runOllama: runOllamaPrompt,
      runCli: runClaudePrompt,
      ollamaCheapModel: startupEnv.ollamaCheapModel,
      ollamaMediumModel: startupEnv.ollamaMediumModel,
      ollamaBaseUrl: startupEnv.ollamaBaseUrl,
      ollamaTimeoutMs: startupEnv.ollamaTaskTimeoutMs,
    })
  : null;

// Route function for entity extraction — uses Ollama routing when available,
// otherwise falls back to Claude CLI directly (same as agent runner).
const routeEntity = modelRouter
  ? modelRouter.route
  : (_task: string, prompt: string) => runClaudePrompt({ prompt }).then(r => r.text);

const runEntityExtraction = async (): Promise<void> => {
  if (!entityStore || !signalStore) return;
  try {
    const rEnv = loadRuntimeEnv(process.env);
    const signals = await signalStore.listAllSignals(rEnv.entityExtractBatchSize);
    for (const signal of signals) {
      try {
        await extractEntities({
          signalText: signal.canonical_text,
          signalId: signal.signal_id,
          route: routeEntity,
          entityStore,
        });
      } catch {
        // Non-critical — skip individual signal failures
      }
    }
  } catch (err) {
    console.error('[entity-extraction] failed:', err);
  }
};

let agentStatus: AgentStatusRecord = {
  isRunning: false,
  intervalMs: startupEnv.agentIntervalMs,
  activeRunId: null,
  lastRun: null,
  lastAttempt: null,
  investigateNext: null
};
let agentRunInFlight: Promise<AgentRunResult> | null = null;
let agentRunInFlightId: string | null = null;
let stateHub: StateHub | null = null;

// Load last run status from DB on startup (survives restarts)
try {
  if (pool) {
    // Mark stale running rows as failed (from previous crash/restart)
    await pool.query(
      `UPDATE agent_runs SET status = 'failed', finished_at = now(), error_message = 'interrupted by server restart' WHERE status = 'running'`
    );
    const [{ rows: completedRows }, { rows: latestRows }] = await Promise.all([
      pool.query(`SELECT * FROM agent_runs WHERE status = 'completed' ORDER BY started_at DESC LIMIT 1`),
      pool.query(`SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 1`)
    ]);
    const completedRow = completedRows[0] as any;
    const latestRow = latestRows[0] as any;
    if (completedRow || latestRow) {
      agentStatus = buildStartupAgentStatus({
        intervalMs: startupEnv.agentIntervalMs,
        completedRow,
        latestRow
      });
    }
  }
} catch { /* DB may not have the table yet */ }

const startAgentRun = (): AgentRunAccepted => {
  if (agentRunInFlight && agentRunInFlightId) {
    return { accepted: true, runId: agentRunInFlightId, alreadyRunning: true };
  }

  const runId = `agent-${Date.now()}`;
  const startedAt = new Date().toISOString();
  agentRunInFlightId = runId;
  const logger = createExecutionLogger({ runId });
  readModel.registerRunId(runId);

  agentStatus = {
    ...agentStatus,
    isRunning: true,
    activeRunId: runId,
    lastAttempt: {
      runId,
      timestamp: startedAt,
      status: 'running',
      provider: null,
      errorMessage: null
    }
  };
  stateHub?.emitAgentStatus(agentStatus);

  agentRunInFlight = (async () => {
    try {
      await agentRunStore?.create(runId);
      await logger.info('agent_runner', 'run started', { run_id: runId });
      const agentEnv = loadRuntimeEnv(process.env);
      const profiles = loadProfiles();

      await logger.info('agent_runner', 'running profiles', {
        profiles: profiles.map(p => p.id),
        count: profiles.length
      });

      const baseDeps = {
        thesisStore,
        signalStore,
        journalStore,
        embedText: (text: string) => embedText(text, { fallbackToNull: true }),
        runClaude: runClaudePrompt,
        runCodex: runCodexPrompt,
        logger,
        runId,
        preferredProvider: agentEnv.aiPrimary,
        allowFallback: agentEnv.aiFallback !== 'none',
        retries: agentEnv.aiRetries,
        timeoutMs: agentEnv.aiTimeoutMs,
        maxClusters: agentEnv.agentMaxClusters,
        ...(pool ? { pool } : {}),
        debateEnabled: agentEnv.debateEnabled,
        debateConfidenceThreshold: agentEnv.debateConfidenceThreshold,
        debateMaxPerRun: agentEnv.debateMaxPerRun,
        cusumThreshold: agentEnv.cusumThreshold,
        cusumDrift: agentEnv.cusumDrift,
      };

      const results = await Promise.allSettled(
        profiles.map(profile =>
          runResearchAgent({ ...baseDeps, profile })
        )
      );

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const p = profiles[i];
        if (!r || !p) continue;
        if (r.status === 'fulfilled') {
          await logger.info('agent_runner', `profile ${p.id} completed`, {
            theses_updated: r.value.thesesUpdated,
            new_candidates: r.value.newCandidates,
          });
        } else {
          await logger.error('agent_runner', `profile ${p.id} failed`, {
            error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          });
        }
      }

      const { aggregated, failedProfiles } = aggregateAgentProfileRuns(profiles, results);

      await agentRunStore?.complete(runId, aggregated);
      await logger.info('agent_runner', 'run complete', {
        theses_updated: aggregated.thesesUpdated,
        new_candidates: aggregated.newCandidates,
        clusters_analyzed: aggregated.clustersAnalyzed,
        deep_dives: aggregated.deepDivesPerformed,
        journal_entries: aggregated.journalEntriesWritten,
        profiles_succeeded: results.filter(r => r.status === 'fulfilled').length,
        profiles_failed: failedProfiles.length,
      });

      const finishedAt = new Date().toISOString();
      agentStatus = {
        isRunning: false,
        intervalMs: startupEnv.agentIntervalMs,
        activeRunId: null,
        lastRun: {
          timestamp: finishedAt,
          thesesUpdated: aggregated.thesesUpdated,
          newCandidates: aggregated.newCandidates,
          clustersAnalyzed: aggregated.clustersAnalyzed,
          deepDivesPerformed: aggregated.deepDivesPerformed,
          journalEntriesWritten: aggregated.journalEntriesWritten,
          provider: aggregated.provider,
        },
        lastAttempt: {
          runId,
          timestamp: finishedAt,
          status: 'completed',
          provider: aggregated.provider,
          errorMessage: null
        },
        investigateNext: aggregated.investigateNext || null,
      };
      stateHub?.emitAgentStatus(agentStatus);
      void stateHub?.broadcastAll();
      stateHub?.emitThesesUpdated();
      return aggregated;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await agentRunStore?.fail(runId, err);
      await logger.error('agent_runner', 'run failed', {
        error: errorMessage
      });
      agentStatus = {
        ...agentStatus,
        isRunning: false,
        activeRunId: null,
        lastAttempt: {
          runId,
          timestamp: new Date().toISOString(),
          status: 'failed',
          provider: null,
          errorMessage
        }
      };
      stateHub?.emitAgentStatus(agentStatus);
      throw err;
    }
  })().finally(() => {
    agentRunInFlight = null;
    agentRunInFlightId = null;
  });

  return { accepted: true, runId, alreadyRunning: false };
};

const executeAgentRun = async (): Promise<AgentRunResult> => {
  startAgentRun();
  return agentRunInFlight!;
};

const ollamaBaseUrl = startupEnv.ollamaBaseUrl;

// --- Ollama health cache --------------------------------------------------
// Extracted so it can be called from both the warmup loop and the status route.
const performOllamaCheck = async (): Promise<{ ok: boolean; reason?: string; sizeMb?: number }> => {
  const embedModel = startupEnv.ollamaEmbedModel;
  try {
    const res = await fetch(`${ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, reason: `ollama returned ${res.status}` };
    const data = await res.json() as { models?: { name: string; size?: number }[] };
    const hasModel = data.models?.some((m) => m.name.startsWith(embedModel)) ?? false;
    let sizeMb: number | undefined;
    try {
      const { execSync } = await import('node:child_process');
      const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
      const duOutput = execSync(`du -sk "${home}/.ollama" 2>/dev/null`, { timeout: 3000 }).toString().trim();
      const kb = parseInt(duOutput.split('\t')[0] ?? '0', 10);
      if (kb > 0) sizeMb = Math.round(kb / 1024);
    } catch { /* disk check optional */ }
    if (!hasModel) return { ok: false as const, reason: `model '${embedModel}' not installed — run: ollama pull ${embedModel}`, ...(sizeMb !== undefined ? { sizeMb } : {}) };
    return { ok: true as const, ...(sizeMb !== undefined ? { sizeMb } : {}) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'connection failed' };
  }
};

// Cache with 8s TTL — just under the 10s WS poll interval so every poll gets a
// fresh check, while still protecting the HTTP endpoint from burst calls.
const OLLAMA_STATUS_TTL_MS = 8_000;
let ollamaStatusCache: { result: { ok: boolean; reason?: string; sizeMb?: number }; ts: number } | null = null;

const checkOllama = async (): Promise<{ ok: boolean; reason?: string; sizeMb?: number }> => {
  const now = Date.now();
  if (ollamaStatusCache && now - ollamaStatusCache.ts < OLLAMA_STATUS_TTL_MS) {
    return ollamaStatusCache.result;
  }
  const result = await performOllamaCheck();
  ollamaStatusCache = { result, ts: Date.now() };
  return result;
};
// -------------------------------------------------------------------------

const serverDeps: Partial<ServerDeps> = {
  listSignals: readModel.listSignals,
  listConnectors: readModel.listConnectors,
  listLogs: readModel.listLogs,
  getAiHealth: readModel.getAiHealth,
  getRefreshMeta: readModel.getRefreshMeta,
  triggerRefresh: async (cadence) => {
    const refreshPromise = readModel.startRefresh(cadence);
    stateHub?.pushRefreshMeta();
    await refreshPromise;
    void stateHub?.broadcastAll();
    void runEntityExtraction();
  },
  thesisStore,
  signalStore,
  deepDiveStore: pool ? createDeepDiveStore({ pool }) : null,
  deepDiveAi: (() => {
    const env = loadRuntimeEnv(process.env);
    return {
      runClaude: runClaudePrompt,
      runCodex: runCodexPrompt,
      preferredProvider: env.aiPrimary,
      allowFallback: env.aiFallback !== 'none'
    };
  })(),
  logger: createExecutionLogger({ runId: 'api-services' }),
  getRouterStats: () => modelRouter
    ? { stats: modelRouter.getStats(), enabled: startupEnv.modelRoutingEnabled }
    : null,
  getAgentStatus: () => ({
    ...agentStatus,
    isRunning: agentRunInFlight !== null,
    activeRunId: agentRunInFlight !== null ? agentRunInFlightId : null
  }),
  triggerAgentRun: startAgentRun,
  agentRunStore,
  corsOrigins,
  ...(pool ? { pool } : {}),
  entityStore,
  infraStatusDeps: {
    checkPostgres: async () => {
      if (!signalStore) return false;
      await signalStore.ping();
      return true;
    },
    checkOllama,
    getEmbeddingStats: async () => {
      if (!signalStore) return { total: 0, withEmbedding: 0, fallbackModel: 'none' };
      return signalStore.getEmbeddingStats();
    },
    ...(pool ? {
      getDiskStats: async () => {
        const dbSize = await pool.query<{ size_mb: number }>(
          `SELECT (pg_database_size(current_database()) / 1024 / 1024)::int AS size_mb`
        );
        const tables = await pool.query<{ name: string; size_mb: number; rows: number }>(
          `SELECT
             relname AS name,
             (pg_total_relation_size(c.oid) / 1024 / 1024)::int AS size_mb,
             reltuples::int AS rows
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r'
           ORDER BY pg_total_relation_size(c.oid) DESC`
        );
        return {
          dbSizeMb: Number(dbSize.rows[0]?.size_mb ?? 0),
          tableSizes: tables.rows.map((r) => ({ name: r.name, sizeMb: Number(r.size_mb), rows: Math.max(0, Number(r.rows)) }))
        };
      }
    } : {})
  }
};
if (apiKey !== undefined) serverDeps.apiKey = apiKey;
const app = await buildServer(serverDeps);

// -- Socket.IO + StateHub -----------------------------------------------
const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(app.server, {
  cors: {
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    methods: ['GET', 'POST'],
  },
  path: '/socket.io/',
});

const infraCheckDeps = serverDeps.infraStatusDeps!;
stateHub = new StateHub(io, {
  getConnectors: readModel.listConnectors,
  getAiHealth: readModel.getAiHealth,
  getAgentStatus: () => ({
    ...agentStatus,
    isRunning: agentRunInFlight !== null,
    activeRunId: agentRunInFlight !== null ? agentRunInFlightId : null
  }),
  getInfraStatus: async () => {
    const [pgResult, ollamaResult, embStats, diskResult] = await Promise.allSettled([
      infraCheckDeps.checkPostgres(),
      infraCheckDeps.checkOllama(),
      infraCheckDeps.getEmbeddingStats(),
      infraCheckDeps.getDiskStats?.() ?? Promise.resolve(null),
    ]);
    const pgOk = pgResult.status === 'fulfilled' && pgResult.value;
    const ollamaCheck = ollamaResult.status === 'fulfilled' ? ollamaResult.value : { ok: false };
    const emb = embStats.status === 'fulfilled' ? embStats.value : { total: 0, withEmbedding: 0, fallbackModel: 'unknown' };
    const disk = diskResult.status === 'fulfilled' && diskResult.value ? diskResult.value : undefined;
    return {
      postgres: pgOk ? 'ok' as const : 'error' as const,
      ollama: ollamaCheck.ok ? 'ok' as const : 'error' as const,
      ...(ollamaCheck.sizeMb != null ? { ollamaSizeMb: ollamaCheck.sizeMb } : {}),
      embeddings: emb,
      ...(disk ? { diskUsage: disk } : {}),
    };
  },
  getRefreshMeta: readModel.getRefreshMeta,
  getSignalCounts: async () => {
    if (!signalStore) return {};
    return signalStore.countSignalsBySource();
  },
  getSignalCount: async () => {
    if (!signalStore) return 0;
    return signalStore.getSignalCount();
  },
  getLatestSignalAt: async () => {
    if (!signalStore) return null;
    return signalStore.getLatestSignalAt();
  },
  getThesisStats: async () => {
    if ('listPaginated' in thesisStore) {
      const page = await (thesisStore as PaginatedThesisStore).listPaginated({ page: 1, pageSize: 1 });
      return page.stats;
    }
    return { total: 0, promoted: 0, watching: 0, totalEvidence: 0, totalSources: 0 };
  },
  getLogs: async () => readModel.listLogs({ limit: 500, scope: 'session' }),
}, {
  infraPollMs: startupEnv.wsInfraPollMs,
  logPollMs: startupEnv.wsLogPollMs,
}, apiKey);

// Push refresh state (including refreshingCadence=null) to WebSocket clients
// after any background refresh completes (e.g. fire-and-forget from ensureFresh)
readModel.setOnRefreshComplete(() => {
  stateHub?.pushRefreshMeta();
});

const DAILY_INTERVAL_MS = startupEnv.connectorDailyRefreshMs;

const triggerRefreshCadence = (cadence: 'hourly' | 'daily', source: 'startup' | 'periodic') => {
  const refreshPromise = readModel.startRefresh(cadence);
  stateHub?.pushRefreshMeta();
  void refreshPromise.then(async () => {
    void stateHub?.broadcastAll();
    void runEntityExtraction();
  }).catch((err) => {
    console.error(`${source} ${cadence} refresh failed:`, err);
  });
  return refreshPromise;
};

const scheduleDueRefreshes = async ({
  hourlyLastRunAt,
  dailyLastRunAt,
  hourlyIntervalMs,
}: {
  hourlyLastRunAt: number;
  dailyLastRunAt: number;
  hourlyIntervalMs: number;
}, source: 'startup' | 'periodic'): Promise<void> => {
  const now = Date.now();
  const hourlyDue = hourlyLastRunAt === 0 || now - hourlyLastRunAt > hourlyIntervalMs;
  const dailyDue = dailyLastRunAt === 0 || now - dailyLastRunAt > DAILY_INTERVAL_MS;
  const started: Promise<unknown>[] = [];

  if (hourlyDue) {
    started.push(triggerRefreshCadence('hourly', source));
  }
  if (dailyDue) {
    started.push(triggerRefreshCadence('daily', source));
  }

  if (started.length === 0) {
    await stateHub.broadcastAll();
    return;
  }

  await Promise.allSettled(started);
};

let agentTimer: ReturnType<typeof setInterval> | undefined;
let cleanupTimer: ReturnType<typeof setInterval> | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let backtestTimer: ReturnType<typeof setInterval> | undefined;
let weightOptTimer: ReturnType<typeof setInterval> | undefined;

const runRetentionCleanup = async () => {
  if (!pool) return;
  const retentionDays = startupEnv.retentionDays;
  if (retentionDays <= 0) return; // 0 = disabled
  try {
    await pool.query(`DELETE FROM scored_signals WHERE updated_at < NOW() - INTERVAL '1 day' * $1`, [retentionDays]);
    await pool.query(`DELETE FROM signal_embeddings WHERE signal_id NOT IN (SELECT signal_id FROM scored_signals)`);
    await pool.query(`DELETE FROM agent_journal WHERE created_at < NOW() - INTERVAL '1 day' * $1`, [retentionDays]);
    await pool.query(`DELETE FROM agent_runs WHERE started_at < NOW() - INTERVAL '1 day' * $1`, [retentionDays]);
  } catch (err) {
    console.error('retention cleanup failed:', err);
  }
};

const SHUTDOWN_TIMEOUT_MS = startupEnv.shutdownTimeoutMs;
const CLEANUP_INTERVAL_MS = startupEnv.cleanupIntervalMs;

let shuttingDown = false;

const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;

  clearInterval(agentTimer);
  clearInterval(cleanupTimer);
  clearInterval(refreshTimer);
  clearInterval(backtestTimer);
  clearInterval(weightOptTimer);
  stateHub.stopPolling();
  io.close();

  // Wait for in-flight agent run, mark as failed if still running
  if (agentRunInFlight) {
    try {
      await Promise.race([
        agentRunInFlight,
        new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown timeout')), SHUTDOWN_TIMEOUT_MS))
      ]);
    } catch {
      if (agentRunInFlightId) {
        const error = buildShutdownInterruptedError(agentRunInFlightId);
        await agentRunStore?.fail(agentRunInFlightId, error);
        agentStatus = {
          ...agentStatus,
          isRunning: false,
          activeRunId: null,
          lastAttempt: {
            runId: agentRunInFlightId,
            timestamp: new Date().toISOString(),
            status: 'failed',
            provider: null,
            errorMessage: error.message
          }
        };
      }
    }
    agentRunInFlight = null;
    agentRunInFlightId = null;
  }

  // readModel.close() closes the shared signalStore pool — don't close it again
  await readModel.close();
  if ('close' in thesisStore) {
    await (thesisStore as { close: () => Promise<void> }).close();
  }
  if (journalStore) {
    await journalStore.close();
  }
  if (pool) {
    await pool.end();
  }
  await app.close();
  process.exit(0);
};

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});

app
  .listen({ host, port })
  .then(async (address) => {
    console.log(`API ready on ${address}`);
    // Collect initial state and start WebSocket polling
    await stateHub.collectAll();
    stateHub.startPolling();
    const runtimeEnv = loadRuntimeEnv(process.env);

    // Warm up Ollama status cache — retries in background until the container is ready.
    // Prevents the Ollama indicator from staying red during Docker startup races.
    void (async () => {
      const WARMUP_TIMEOUT_MS = 60_000;
      const WARMUP_RETRY_MS = 3_000;
      const deadline = Date.now() + WARMUP_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const result = await performOllamaCheck();
        ollamaStatusCache = { result, ts: Date.now() };
        if (result.ok) break;
        await new Promise<void>((r) => setTimeout(r, WARMUP_RETRY_MS));
      }
    })().catch(() => {});

    // Only refresh on startup if data is actually stale (avoids re-ingesting on every restart)
    void (async () => {
      const state = await readModel.peekState();
      await scheduleDueRefreshes({
        hourlyLastRunAt: state.lastHourlyRunAt,
        dailyLastRunAt: state.lastDailyRunAt,
        hourlyIntervalMs: runtimeEnv.connectorRefreshMs,
      }, 'startup');
    })().catch(() => {});
    setTimeout(() => stateHub.pushRefreshMeta(), 500);

    // If overdue from a previous session, run immediately then start the regular interval
    if (isAgentCatchUpDue(agentStatus, runtimeEnv.agentIntervalMs)) {
      void executeAgentRun().catch((err) => {
        console.error('research agent catch-up run failed:', err);
      });
    }

    agentTimer = setInterval(() => {
      void executeAgentRun().catch((err) => {
        console.error('research agent cron failed:', err);
      });
    }, runtimeEnv.agentIntervalMs);

    // Periodic connector refresh (was driven by client polling before WebSocket migration)
    refreshTimer = setInterval(() => {
      const meta = readModel.getRefreshMeta();
      const hourlyLastRunAt = meta.last_hourly_run ? new Date(meta.last_hourly_run).getTime() : 0;
      const dailyLastRunAt = meta.last_daily_run ? new Date(meta.last_daily_run).getTime() : 0;
      void scheduleDueRefreshes({
        hourlyLastRunAt,
        dailyLastRunAt,
        hourlyIntervalMs: runtimeEnv.connectorRefreshMs,
      }, 'periodic');
    }, runtimeEnv.connectorRefreshMs);

    cleanupTimer = setInterval(() => void runRetentionCleanup(), CLEANUP_INTERVAL_MS);
    void runRetentionCleanup();

    // Weekly backtesting: snapshot predictions + validate old ones
    if (pool && signalStore) backtestTimer = setInterval(async () => {
      try {
        const snapResult = await snapshotPredictions({ pool, thesisStore, confidenceThreshold: 50 });
        console.log(`[backtest] Snapshotted ${snapResult.snapshotted} predictions`);

        const valResult = await validatePredictions({
          pool,
          searchRecentSignals: async (thesisKey: string) => {
            const thesis = await thesisStore.getByKey(thesisKey);
            if (!thesis) return [];
            const signals = await signalStore.listAllSignals(100);
            return signals
              .filter(s => s.topic === thesis.topic)
              .map(s => ({ source: s.source, canonical_text: s.canonical_text }));
          },
          validateAfterDays: runtimeEnv.backtestValidateAfterDays,
          ...(experienceStore ? { experienceStore } : {}),
          getThesisSummary: async (thesisKey: string) => {
            const thesis = await thesisStore.getByKey(thesisKey);
            if (!thesis) return null;
            return {
              title: thesis.title,
              problemStatement: thesis.problemStatement ?? '',
              evidence: thesis.evidence?.map((e: any) => typeof e === 'string' ? e : (e.snippet ?? '')) ?? [],
              confidence: thesis.confidence,
            };
          },
        });
        console.log(`[backtest] Validated ${valResult.validated}/${valResult.checked} predictions`);
      } catch (err) {
        console.error('[backtest] Error:', err);
      }
    }, runtimeEnv.backtestSnapshotIntervalMs);

    // Periodic weight optimization (check if enough data has accumulated)
    if (pool && runtimeEnv.weightOptEnabled) {
      weightOptTimer = setInterval(async () => {
        try {
          const result = await runWeightOptimization({
            pool,
            minPredictions: runtimeEnv.weightOptMinPredictions,
            minImprovement: runtimeEnv.weightOptMinImprovement,
            gridStep: runtimeEnv.weightOptGridStep,
          });
          if (result.skipped) {
            console.log(`[weight-opt] Skipped: ${result.reason}`);
          } else {
            console.log(`[weight-opt] Updated weights: precision ${((result.precision ?? 0) * 100).toFixed(1)}%`);
          }
        } catch (err) {
          console.error('[weight-opt] Error:', err);
        }
      }, runtimeEnv.weightOptIntervalMs);
    }
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
