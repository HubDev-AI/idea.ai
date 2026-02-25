import { loadEnvFile } from './config/dotenv';
import { buildServer } from './server';
import { createLiveReadModel } from './runtime/live_read_model';

loadEnvFile();

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const readModel = createLiveReadModel();

const app = buildServer({
  listSignals: readModel.listSignals,
  listConnectors: readModel.listConnectors,
  listLogs: readModel.listLogs,
  getAiHealth: readModel.getAiHealth
});

const shutdown = async () => {
  await readModel.close();
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
