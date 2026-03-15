import { runClaudePrompt } from '@idea/ai-runtime/src/claude';
import { loadEnvFile } from '../src/config/dotenv';
import { createEntityStore } from '../src/runtime/entity_store';
import { createPostgresSignalStore } from '../src/runtime/postgres_signal_store';
import { extractEntities } from '../src/jobs/entity_extractor';
import { embedText } from '@idea/ai-runtime/src/ollama';
import pg from 'pg';

const main = async () => {
  loadEnvFile();
  const databaseUrl = process.env.DATABASE_URL!;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const embedTextFn = (text: string) => embedText(text, { fallbackToNull: true });
  const signalStore = createPostgresSignalStore({ databaseUrl, embedText: embedTextFn });
  const entityStore = createEntityStore({ pool });
  const route = (_task: string, prompt: string) => runClaudePrompt({ prompt }).then(r => r.text);

  const signals = await signalStore.listAllSignals(50);
  console.log(`Extracting entities from ${signals.length} signals...`);

  let total = 0;
  for (const signal of signals) {
    try {
      const count = await extractEntities({
        signalText: signal.canonical_text,
        signalId: signal.signal_id,
        route,
        entityStore,
      });
      total += count;
      process.stdout.write('.');
    } catch {
      process.stdout.write('x');
    }
  }
  console.log(`\nExtracted ${total} entities from ${signals.length} signals`);
  await pool.end();
  await signalStore.close();
};

main().catch(console.error);
