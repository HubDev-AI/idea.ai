import { runClaudePrompt } from '@idea/ai-runtime/src/claude';
import { runCodexPrompt } from '@idea/ai-runtime/src/codex';
import { embedText } from '@idea/ai-runtime/src/ollama';
import type { AgentStatusRecord } from '@idea/contracts/src/api';
import pg from 'pg';
import { loadEnvFile } from './config/dotenv';
import { resolveAiJudgeSettings } from './jobs/ai_judges';
import { type AgentRunResult, runResearchAgent } from './jobs/agent_runner';
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

let agentStatus: AgentStatusRecord = { lastRun: null, investigateNext: null };
let agentRunInFlight: Promise<AgentRunResult> | null = null;

// Load last run status from DB on startup (survives restarts)
if (agentRunStore) {
  agentRunStore.latest().then((row) => {
    if (row && row.status === 'completed') {
      agentStatus = {
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
  }).catch(() => { /* DB may not have the table yet */ });
}

const executeAgentRun = async (): Promise<AgentRunResult> => {
  if (agentRunInFlight) return agentRunInFlight;

  const runId = `agent-${Date.now()}`;
  const logger = createExecutionLogger({ runId });

  agentRunInFlight = (async () => {
    await agentRunStore?.create(runId);
    await logger.info('agent_runner', 'run started', { run_id: runId });

    try {
      const result = await runResearchAgent({
        thesisStore,
        memoryStore,
        journalStore,
        embedText: (text: string) => embedText(text, { fallbackToNull: true }),
        runClaude: runClaudePrompt,
        runCodex: runCodexPrompt,
        logger,
        runId,
        preferredProvider: resolveAiJudgeSettings(process.env).preferredProvider
      });

      await agentRunStore?.complete(runId, result);
      await logger.info('agent_runner', 'run complete', {
        theses_updated: result.thesesUpdated,
        new_candidates: result.newCandidates,
        clusters_analyzed: result.clustersAnalyzed,
        deep_dives: result.deepDivesPerformed,
        journal_entries: result.journalEntriesWritten
      });

      agentStatus = {
        lastRun: {
          timestamp: new Date().toISOString(),
          thesesUpdated: result.thesesUpdated,
          newCandidates: result.newCandidates,
          clustersAnalyzed: result.clustersAnalyzed,
          deepDivesPerformed: result.deepDivesPerformed,
          journalEntriesWritten: result.journalEntriesWritten,
          provider: result.provider
        },
        investigateNext: result.investigateNext || null
      };
      return result;
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
  getAgentStatus: () => agentStatus,
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
    const AGENT_INTERVAL_MS = 2 * 60 * 60 * 1000;
    agentTimer = setInterval(() => {
      void executeAgentRun().catch((err) => {
        console.error('research agent cron failed:', err);
      });
    }, AGENT_INTERVAL_MS);
    cleanupTimer = setInterval(() => void runRetentionCleanup(), CLEANUP_INTERVAL_MS);
    void runRetentionCleanup();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
