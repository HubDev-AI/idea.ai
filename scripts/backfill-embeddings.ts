import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pg = require('pg') as typeof import('pg');

import { buildLocalEmbedding } from '../apps/api/src/jobs/memory_index';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://idea_ai:idea_ai_dev@127.0.0.1:5917/idea_ai';

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

const run = async () => {
  const { rows } = await pool.query<{ signal_id: string; canonical_text: string }>(`
    SELECT sm.signal_id, sm.canonical_text
    FROM signal_memory sm
    LEFT JOIN signal_embeddings se ON sm.signal_id = se.signal_id
    WHERE se.signal_id IS NULL
  `);

  console.log(`Backfilling ${rows.length} missing embeddings...`);

  let done = 0;
  for (const row of rows) {
    const embedding = buildLocalEmbedding(row.canonical_text);
    await pool.query(
      `INSERT INTO signal_embeddings (signal_id, embedding, model)
       VALUES ($1, $2, $3)
       ON CONFLICT (signal_id) DO NOTHING`,
      [row.signal_id, JSON.stringify(embedding), 'local-hash-v1']
    );
    done++;
    if (done % 200 === 0) console.log(`  ${done}/${rows.length}`);
  }

  console.log(`Done. Backfilled ${done} embeddings.`);
  await pool.end();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
