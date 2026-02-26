import { loadEnvFile } from './config/dotenv';
import { buildServer } from './server';
import { createLiveReadModel } from './runtime/live_read_model';
import { InMemoryThesisStore } from './runtime/thesis_store';
import { createPostgresMemoryStore } from './runtime/postgres_memory_store';

loadEnvFile();

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const readModel = createLiveReadModel();
const thesisStore = new InMemoryThesisStore();

const databaseUrl = process.env.DATABASE_URL;
const memoryStore = databaseUrl
  ? createPostgresMemoryStore({ databaseUrl })
  : null;

const app = buildServer({
  listSignals: readModel.listSignals,
  listConnectors: readModel.listConnectors,
  listLogs: readModel.listLogs,
  getAiHealth: readModel.getAiHealth,
  thesisStore,
  memoryStore,
  corsOrigins
});

const shutdown = async () => {
  await readModel.close();
  if (memoryStore) {
    await memoryStore.close();
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
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
