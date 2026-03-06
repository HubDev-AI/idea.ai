import { runClaudePrompt } from '@idea/ai-runtime/src/claude';
import { runCodexPrompt } from '@idea/ai-runtime/src/codex';
import { embedText } from '@idea/ai-runtime/src/ollama';
import type { AgentStatusRecord } from '@idea/contracts/src/api';
import pg from 'pg';
import { loadEnvFile } from './config/dotenv';
import { loadRuntimeEnv } from './config/env';
import { resolveAiJudgeSettings } from './jobs/ai_judges';
import { type AgentRunResult, runResearchAgent } from './jobs/agent_runner';
import { loadProfiles } from './profiles/index.js';
import { type AgentRunStore, createAgentRunStore } from './runtime/agent_run_store';
import { createDeepDiveStore } from './runtime/deep_dive_store';
import { createExecutionLogger } from './runtime/execution_logger';
import { createPostgresJournalStore } from './runtime/journal_store';
import { createLiveReadModel } from './runtime/live_read_model';
import { createPostgresMemoryStore } from './runtime/postgres_memory_store';
import { createPostgresThesisStore } from './runtime/postgres_thesis_store';
import { InMemoryThesisStore } from './runtime/thesis_store';
import { buildServer } from './server';

loadEnvFile();

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const apiKey = process.env.API_KEY || undefined;
const databaseUrl = process.env.DATABASE_URL;

const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl, max: 4 }) : null;

const thesisStore = pool
  ? createPostgresThesisStore({ pool })
  : new InMemoryThesisStore();

const embedTextFn = (text: string) => embedText(text, { fallbackToNull: true });

const memoryStore = databaseUrl
  ? createPostgresMemoryStore({ databaseUrl, embedText: embedTextFn })
  : null;

const readModel = createLiveReadModel(undefined, memoryStore ? { persistentStore: memoryStore } : undefined);

const journalStore = databaseUrl
  ? createPostgresJournalStore({ databaseUrl })
  : null;

const agentRunStore: AgentRunStore | null = pool
  ? createAgentRunStore({ pool })
  : null;

let agentStatus: AgentStatusRecord = { isRunning: false, lastRun: null, investigateNext: null };
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

    try {
      const agentEnv = loadRuntimeEnv(process.env);
      const profiles = loadProfiles();

      await logger.info('agent_runner', 'running profiles', {
        profiles: profiles.map(p => p.id),
        count: profiles.length
      });

      const baseDeps = {
        thesisStore,
        memoryStore,
        journalStore,
        embedText: (text: string) => embedText(text, { fallbackToNull: true }),
        runClaude: runClaudePrompt,
        runCodex: runCodexPrompt,
        logger,
        runId,
        preferredProvider: resolveAiJudgeSettings(process.env).preferredProvider,
        timeoutMs: agentEnv.agentTimeoutMs,
        maxClusters: agentEnv.agentMaxClusters,
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

const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

const serverDeps: Parameters<typeof buildServer>[0] = {
  listSignals: readModel.listSignals,
  listConnectors: readModel.listConnectors,
  listLogs: readModel.listLogs,
  getAiHealth: readModel.getAiHealth,
  getRefreshMeta: readModel.getRefreshMeta,
  triggerRefresh: async (cadence) => { await readModel.refresh(cadence); },
  thesisStore,
  memoryStore,
  deepDiveStore: pool ? createDeepDiveStore({ pool }) : null,
  deepDiveAi: {
    runClaude: runClaudePrompt,
    runCodex: runCodexPrompt,
    preferredProvider: resolveAiJudgeSettings(process.env).preferredProvider
  },
  logger: createExecutionLogger({ runId: 'api-services' }),
  getAgentStatus: () => ({ ...agentStatus, isRunning: agentRunInFlight !== null }),
  triggerAgentRun: executeAgentRun,
  agentRunStore,
  corsOrigins,
  infraStatusDeps: {
    checkPostgres: async () => {
      if (!memoryStore) return false;
      await memoryStore.ping();
      return true;
    },
    checkOllama: async () => {
      const res = await fetch(`${ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    },
    getEmbeddingStats: async () => {
      if (!memoryStore) return { total: 0, withEmbedding: 0, fallbackModel: 'none' };
      return memoryStore.getEmbeddingStats();
    }
  }
};
if (apiKey !== undefined) serverDeps.apiKey = apiKey;
const app = await buildServer(serverDeps);

let agentTimer: ReturnType<typeof setInterval> | undefined;
let cleanupTimer: ReturnType<typeof setInterval> | undefined;

const RETENTION_DAYS = 90;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

const runRetentionCleanup = async () => {
  if (!pool) return;
  try {
    await pool.query(`DELETE FROM signal_memory WHERE observed_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`);
    await pool.query(`DELETE FROM signal_embeddings WHERE signal_id NOT IN (SELECT signal_id FROM signal_memory)`);
    await pool.query(`DELETE FROM agent_journal WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`);
    await pool.query(`DELETE FROM agent_runs WHERE started_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`);
  } catch (err) {
    console.error('retention cleanup failed:', err);
  }
};

const SHUTDOWN_TIMEOUT_MS = 15_000;

const shutdown = async () => {
  clearInterval(agentTimer);
  clearInterval(cleanupTimer);

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

  await readModel.close();
  if (memoryStore) {
    await memoryStore.close();
  }
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
  .then((address) => {
    console.log(`API ready on ${address}`);
    const runtimeEnv = loadRuntimeEnv(process.env);

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
    cleanupTimer = setInterval(() => void runRetentionCleanup(), CLEANUP_INTERVAL_MS);
    void runRetentionCleanup();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
