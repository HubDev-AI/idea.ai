import { runClaudePrompt } from '@idea/ai-runtime/src/claude';
import { runCodexPrompt } from '@idea/ai-runtime/src/codex';
import { embedText } from '@idea/ai-runtime/src/ollama';
import { runOllamaPrompt } from '@idea/ai-runtime/src/ollama_prompt';
import { createRouter } from '@idea/ai-runtime/src/router';
import type { AgentStatusRecord } from '@idea/contracts/src/api';
import type { ClientToServerEvents, ServerToClientEvents } from '@idea/contracts/src/ws';
import pg from 'pg';
import { Server as SocketIOServer } from 'socket.io';
import { loadEnvFile } from './config/dotenv';
import { loadRuntimeEnv } from './config/env';
import { type AgentRunResult, runResearchAgent } from './jobs/agent_runner';
import { extractEntities } from './jobs/entity_extractor';
import { snapshotPredictions } from './jobs/backtest_snapshot';
import { validatePredictions } from './jobs/backtest_validate';
import { resolveAiJudgeSettings } from './jobs/ai_judges';
import { runWeightOptimization } from './jobs/weight_optimizer_job';
import { loadProfiles } from './profiles/index.js';
import { type AgentRunStore, createAgentRunStore } from './runtime/agent_run_store';
import { createDeepDiveStore } from './runtime/deep_dive_store';
import { createEntityStore } from './runtime/entity_store';
import { createExecutionLogger } from './runtime/execution_logger';
import { createExperienceStore } from './runtime/experience_store';
import { createPostgresJournalStore } from './runtime/journal_store';
import { createLiveReadModel } from './runtime/live_read_model';
import { createPostgresSignalStore } from './runtime/postgres_signal_store';
import { createPostgresThesisStore, type PaginatedThesisStore } from './runtime/postgres_thesis_store';
import { createProviderCircuitBreaker } from './runtime/provider_circuit';
import { InMemoryThesisStore } from './runtime/thesis_store';
import { buildServer } from './server';
import { StateHub } from './ws/state_hub';

loadEnvFile();

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const apiKey = process.env.API_KEY || undefined;
const databaseUrl = process.env.DATABASE_URL;

const startupEnv = loadRuntimeEnv(process.env);
const providerCircuit = createProviderCircuitBreaker({
  threshold: startupEnv.circuitBreakerThreshold,
  cooldownMs: startupEnv.circuitBreakerCooldownMs,
});
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl, max: 4 }) : null;

const thesisStore = pool
  ? createPostgresThesisStore({ pool })
  : new InMemoryThesisStore();

const embedTextFn = (text: string) => embedText(text, { fallbackToNull: true });

const signalStore = databaseUrl
  ? createPostgresSignalStore({ databaseUrl, embedText: embedTextFn })
  : null;

const readModel = createLiveReadModel(undefined, {
  ...(signalStore ? { persistentStore: signalStore } : {}),
  circuit: providerCircuit,
  ...(pool ? { pool } : {}),
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

let agentStatus: AgentStatusRecord = { isRunning: false, intervalMs: startupEnv.agentIntervalMs, lastRun: null, investigateNext: null };
let agentRunInFlight: Promise<AgentRunResult> | null = null;

// Load last run status from DB on startup (survives restarts)
try {
  if (pool) {
    // Mark stale running rows as failed (from previous crash/restart)
    await pool.query(
      `UPDATE agent_runs SET status = 'failed', finished_at = now(), error_message = 'interrupted by server restart' WHERE status = 'running'`
    );
    // Load last completed run for display
    const { rows } = await pool.query(
      `SELECT * FROM agent_runs WHERE status = 'completed' ORDER BY started_at DESC LIMIT 1`
    );
    const row = rows[0] as any;
    if (row) {
      agentStatus = {
        isRunning: false,
        intervalMs: startupEnv.agentIntervalMs,
        lastRun: {
          timestamp: row.started_at,
          thesesUpdated: row.theses_updated,
          newCandidates: row.new_candidates,
          clustersAnalyzed: row.clusters_analyzed,
          deepDivesPerformed: row.deep_dives_performed,
          journalEntriesWritten: row.journal_entries_written,
          provider: row.provider ?? null
        },
        investigateNext: row.investigate_next
      };
    }
  }
} catch { /* DB may not have the table yet */ }

const executeAgentRun = async (): Promise<AgentRunResult> => {
  if (agentRunInFlight) return agentRunInFlight;

  const runId = `agent-${Date.now()}`;
  const logger = createExecutionLogger({ runId });
  readModel.registerRunId(runId);

  agentRunInFlight = (async () => {
    await agentRunStore?.create(runId);
    await logger.info('agent_runner', 'run started', { run_id: runId });
    stateHub.emitAgentStatus({ ...agentStatus, isRunning: true });

    try {
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
        preferredProvider: resolveAiJudgeSettings(process.env).preferredProvider,
        timeoutMs: agentEnv.agentTimeoutMs,
        maxClusters: agentEnv.agentMaxClusters,
        pool: pool ?? undefined,
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

      // Aggregate results across all profiles
      const aggregated: AgentRunResult = {
        thesesUpdated: 0,
        newCandidates: 0,
        alerts: [],
        investigateNext: '',
        journalEntriesWritten: 0,
        clustersAnalyzed: 0,
        deepDivesPerformed: 0,
        debatesPerformed: 0,
        provider: null,
      };

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const p = profiles[i];
        if (r.status === 'fulfilled') {
          aggregated.thesesUpdated += r.value.thesesUpdated;
          aggregated.newCandidates += r.value.newCandidates;
          aggregated.alerts.push(...r.value.alerts);
          aggregated.journalEntriesWritten += r.value.journalEntriesWritten;
          aggregated.clustersAnalyzed += r.value.clustersAnalyzed;
          aggregated.deepDivesPerformed += r.value.deepDivesPerformed;
          aggregated.debatesPerformed = (aggregated.debatesPerformed ?? 0) + (r.value.debatesPerformed ?? 0);
          if (!aggregated.provider) aggregated.provider = r.value.provider;
          if (!aggregated.investigateNext) aggregated.investigateNext = r.value.investigateNext;
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

      await agentRunStore?.complete(runId, aggregated);
      await logger.info('agent_runner', 'run complete', {
        theses_updated: aggregated.thesesUpdated,
        new_candidates: aggregated.newCandidates,
        clusters_analyzed: aggregated.clustersAnalyzed,
        deep_dives: aggregated.deepDivesPerformed,
        journal_entries: aggregated.journalEntriesWritten,
        profiles_succeeded: results.filter(r => r.status === 'fulfilled').length,
        profiles_failed: results.filter(r => r.status === 'rejected').length,
      });

      agentStatus = {
        isRunning: false,
        intervalMs: startupEnv.agentIntervalMs,
        lastRun: {
          timestamp: new Date().toISOString(),
          thesesUpdated: aggregated.thesesUpdated,
          newCandidates: aggregated.newCandidates,
          clustersAnalyzed: aggregated.clustersAnalyzed,
          deepDivesPerformed: aggregated.deepDivesPerformed,
          journalEntriesWritten: aggregated.journalEntriesWritten,
          provider: aggregated.provider,
        },
        investigateNext: aggregated.investigateNext || null,
      };
      // Push updates via WebSocket after agent run
      void stateHub.broadcastAll();
      stateHub.emitThesesUpdated();
      return aggregated;
    } catch (err) {
      await agentRunStore?.fail(runId, err);
      await logger.error('agent_runner', 'run failed', {
        error: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  })().finally(() => {
    agentRunInFlight = null;
  });

  return agentRunInFlight;
};

const ollamaBaseUrl = startupEnv.ollamaBaseUrl;

const serverDeps: Parameters<typeof buildServer>[0] = {
  listSignals: readModel.listSignals,
  listConnectors: readModel.listConnectors,
  listLogs: readModel.listLogs,
  getAiHealth: readModel.getAiHealth,
  getRefreshMeta: readModel.getRefreshMeta,
  triggerRefresh: async (cadence) => {
    stateHub.pushRefreshMeta();
    await readModel.refresh(cadence);
    void stateHub.broadcastAll();

    // Entity extraction: run after refresh if both entityStore and modelRouter are available
    if (entityStore && modelRouter && signalStore) {
      try {
        const rEnv = loadRuntimeEnv(process.env);
        const signals = await signalStore.listAllSignals(rEnv.entityExtractBatchSize);
        for (const signal of signals) {
          try {
            await extractEntities({
              signalText: signal.canonical_text,
              signalId: signal.signal_id,
              route: modelRouter.route,
              entityStore,
            });
          } catch {
            // Non-critical — skip individual signal failures
          }
        }
      } catch {
        // Non-critical — entity extraction is best-effort
      }
    }
  },
  thesisStore,
  signalStore,
  deepDiveStore: pool ? createDeepDiveStore({ pool }) : null,
  deepDiveAi: {
    runClaude: runClaudePrompt,
    runCodex: runCodexPrompt,
    preferredProvider: resolveAiJudgeSettings(process.env).preferredProvider
  },
  logger: createExecutionLogger({ runId: 'api-services' }),
  getRouterStats: () => modelRouter
    ? { stats: modelRouter.getStats(), enabled: startupEnv.modelRoutingEnabled }
    : null,
  getAgentStatus: () => ({ ...agentStatus, isRunning: agentRunInFlight !== null }),
  triggerAgentRun: executeAgentRun,
  agentRunStore,
  corsOrigins,
  pool: pool ?? undefined,
  entityStore,
  infraStatusDeps: {
    checkPostgres: async () => {
      if (!signalStore) return false;
      await signalStore.ping();
      return true;
    },
    checkOllama: async () => {
      const embedModel = startupEnv.ollamaEmbedModel;
      try {
        const res = await fetch(`${ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return { ok: false, reason: `ollama returned ${res.status}` };
        const data = await res.json() as { models?: { name: string; size?: number }[] };
        const hasModel = data.models?.some((m) => m.name.startsWith(embedModel)) ?? false;
        // Get actual disk usage from ~/.ollama directory
        let sizeMb: number | undefined;
        try {
          const { execSync } = await import('node:child_process');
          const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
          const duOutput = execSync(`du -sk "${home}/.ollama" 2>/dev/null`, { timeout: 3000 }).toString().trim();
          const kb = parseInt(duOutput.split('\t')[0] ?? '0', 10);
          if (kb > 0) sizeMb = Math.round(kb / 1024);
        } catch { /* disk check optional */ }
        if (!hasModel) return { ok: false, reason: `model '${embedModel}' not installed — run: ollama pull ${embedModel}`, sizeMb };
        return { ok: true, sizeMb };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : 'connection failed' };
      }
    },
    getEmbeddingStats: async () => {
      if (!signalStore) return { total: 0, withEmbedding: 0, fallbackModel: 'none' };
      return signalStore.getEmbeddingStats();
    },
    getDiskStats: pool ? async () => {
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
    } : undefined
  }
};
if (apiKey !== undefined) serverDeps.apiKey = apiKey;
const app = await buildServer(serverDeps);

// -- Socket.IO + StateHub -----------------------------------------------
const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(app.server, {
  cors: {
    origin: corsOrigins.length > 0 ? corsOrigins : '*',
    methods: ['GET', 'POST'],
  },
  path: '/socket.io/',
});

const infraCheckDeps = serverDeps.infraStatusDeps!;
const stateHub = new StateHub(io, {
  getConnectors: readModel.listConnectors,
  getAiHealth: readModel.getAiHealth,
  getAgentStatus: () => ({ ...agentStatus, isRunning: agentRunInFlight !== null }),
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
});

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
    await pool.query(`DELETE FROM scored_signals WHERE observed_at < NOW() - INTERVAL '1 day' * $1`, [retentionDays]);
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
      // Run was interrupted or timed out — agentRunStore.fail() already called in executeAgentRun's catch block
    }
    agentRunInFlight = null;
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

    // Trigger initial data refresh and broadcast
    void readModel.refresh().then(() => stateHub.broadcastAll()).catch(() => {});
    // Push refreshMeta immediately so clients see the "refreshing" state
    setTimeout(() => stateHub.pushRefreshMeta(), 500);

    // If overdue from a previous session, run immediately then start the regular interval
    const lastRunTs = agentStatus.lastRun?.timestamp;
    const isOverdue = lastRunTs && (Date.now() - new Date(lastRunTs).getTime()) > runtimeEnv.agentIntervalMs;
    if (isOverdue) {
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
      stateHub.pushRefreshMeta();
      void readModel.refresh().then(() => stateHub.broadcastAll()).catch((err) => {
        console.error('periodic refresh failed:', err);
      });
    }, runtimeEnv.agentIntervalMs);

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
          experienceStore: experienceStore ?? undefined,
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
