import pg from 'pg';
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

const serverDeps: Parameters<typeof buildServer>[0] = {
  listSignals: readModel.listSignals,
  listConnectors: readModel.listConnectors,
  listLogs: readModel.listLogs,
  getAiHealth: readModel.getAiHealth,
  thesisStore,
  memoryStore,
  corsOrigins
};
if (apiKey !== undefined) serverDeps.apiKey = apiKey;
const app = await buildServer(serverDeps);

const shutdown = async () => {
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
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
