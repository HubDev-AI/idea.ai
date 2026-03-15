import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pg = require('pg') as any;

import { embedText } from '../packages/ai-runtime/src/ollama';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://idea_ai:idea_ai_dev@127.0.0.1:5917/idea_ai';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';
const BATCH_SIZE = 10; // concurrent Ollama calls

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

const run = async () => {
  // Find signals missing embeddings OR still using local-hash fallback
  const { rows } = await pool.query(`
    SELECT sm.signal_id, sm.canonical_text
    FROM scored_signals sm
    LEFT JOIN signal_embeddings se ON sm.signal_id = se.signal_id
    WHERE se.signal_id IS NULL
       OR se.model = 'local-hash-v1'
  `) as { rows: { signal_id: string; canonical_text: string }[] };

  console.log(`Backfilling ${rows.length} missing embeddings via Ollama (${OLLAMA_MODEL})...`);

  let done = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (row: { signal_id: string; canonical_text: string }) => {
        const embedding = await embedText(row.canonical_text, {
          model: OLLAMA_MODEL,
          baseUrl: OLLAMA_BASE_URL,
        });
        if (!embedding) throw new Error('null embedding');
        await pool.query(
          `INSERT INTO signal_embeddings (signal_id, embedding, model)
           VALUES ($1, $2::vector, $3)
           ON CONFLICT (signal_id) DO UPDATE SET
             embedding = EXCLUDED.embedding,
             model = EXCLUDED.model,
             created_at = NOW()`,
          [row.signal_id, `[${embedding.join(',')}]`, `ollama-${OLLAMA_MODEL}`]
        );
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') done++;
      else failed++;
    }

    if ((done + failed) % 100 === 0 || i + BATCH_SIZE >= rows.length) {
      console.log(`  ${done + failed}/${rows.length} (${done} ok, ${failed} failed)`);
    }
  }

  console.log(`Done. Backfilled ${done} embeddings, ${failed} failed.`);
  await pool.end();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
