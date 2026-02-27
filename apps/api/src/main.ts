import pg from 'pg';
import type { AgentStatusRecord } from '@idea/contracts/src/api';
import { runClaudePrompt } from '@idea/ai-runtime/src/claude';
import { runCodexPrompt } from '@idea/ai-runtime/src/codex';
import { type AgentRunResult, runResearchAgent } from './jobs/agent_runner';
import { loadEnvFile } from './config/dotenv';
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
const readModel = createLiveReadModel();
const databaseUrl = process.env.DATABASE_URL;

const thesisStore = databaseUrl
  ? createPostgresThesisStore({ pool: new pg.Pool({ connectionString: databaseUrl, max: 4 }) })
  : new InMemoryThesisStore();

const memoryStore = databaseUrl
  ? createPostgresMemoryStore({ databaseUrl })
  : null;

let agentStatus: AgentStatusRecord = { lastRun: null, investigateNext: null };
let agentRunInFlight: Promise<AgentRunResult> | null = null;

const executeAgentRun = async (): Promise<AgentRunResult> => {
  if (agentRunInFlight) return agentRunInFlight;

  agentRunInFlight = runResearchAgent({
    thesisStore,
    memoryStore,
    runClaude: runClaudePrompt,
    runCodex: runCodexPrompt
  }).finally(() => {
    agentRunInFlight = null;
  });

  const result = await agentRunInFlight;
  agentStatus = {
    lastRun: {
      timestamp: new Date().toISOString(),
      thesesUpdated: result.thesesUpdated,
      newCandidates: result.newCandidates
    },
    investigateNext: result.investigateNext || null
  };
  return result;
};

const serverDeps: Parameters<typeof buildServer>[0] = {
  listSignals: readModel.listSignals,
  listConnectors: readModel.listConnectors,
  listLogs: readModel.listLogs,
  getAiHealth: readModel.getAiHealth,
  thesisStore,
  memoryStore,
  getAgentStatus: () => agentStatus,
  triggerAgentRun: executeAgentRun,
  corsOrigins
};
if (apiKey !== undefined) serverDeps.apiKey = apiKey;
const app = await buildServer(serverDeps);

let agentTimer: ReturnType<typeof setInterval> | undefined;

const shutdown = async () => {
  clearInterval(agentTimer);
  await readModel.close();
  if (memoryStore) {
    await memoryStore.close();
  }
  if ('close' in thesisStore) {
    await (thesisStore as { close: () => Promise<void> }).close();
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
    const AGENT_INTERVAL_MS = 30 * 60 * 1000;
    agentTimer = setInterval(() => {
      void executeAgentRun().catch((err) => {
        console.error('research agent cron failed:', err);
      });
    }, AGENT_INTERVAL_MS);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
