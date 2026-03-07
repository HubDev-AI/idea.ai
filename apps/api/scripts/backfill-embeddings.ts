import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://idea_ai:idea_ai_dev@127.0.0.1:5917/idea_ai';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';
const BATCH_SIZE = 50;

const toVectorLiteral = (vec: number[]): string => `[${vec.join(',')}]`;

const embedText = async (text: string): Promise<number[] | null> => {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: text })
    });
    if (!res.ok) return null;
    const data = await res.json() as { embeddings: number[][] };
    return data.embeddings[0] ?? null;
  } catch {
    return null;
  }
};

const main = async () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

  const { rows: [{ count }] } = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int as count
     FROM signal_memory sm
     LEFT JOIN signal_embeddings se ON se.signal_id = sm.signal_id
     WHERE se.signal_id IS NULL`
  );

  console.log(`${count} signals missing embeddings`);
  if (count === 0) {
    await pool.end();
    return;
  }

  let processed = 0;
  let embedded = 0;
  let failed = 0;
  const failedIds = new Set<string>();

  while (true) {
    const { rows } = await pool.query<{ signal_id: string; canonical_text: string }>(
      `SELECT sm.signal_id, sm.canonical_text
       FROM signal_memory sm
       LEFT JOIN signal_embeddings se ON se.signal_id = sm.signal_id
       WHERE se.signal_id IS NULL
       ORDER BY sm.observed_at DESC
       LIMIT $1`,
      [BATCH_SIZE]
    );

    // Filter out signals we've already failed to embed
    const todo = rows.filter((r) => !failedIds.has(r.signal_id));
    if (todo.length === 0) break;

    for (const row of todo) {
      const embedding = await embedText(row.canonical_text);
      processed++;

      if (embedding) {
        await pool.query(
          `INSERT INTO signal_embeddings (signal_id, embedding, model, created_at)
           VALUES ($1, $2::vector, $3, NOW())
           ON CONFLICT (signal_id)
           DO UPDATE SET embedding = EXCLUDED.embedding, model = EXCLUDED.model, created_at = NOW()`,
          [row.signal_id, toVectorLiteral(embedding), EMBED_MODEL]
        );
        embedded++;
      } else {
        failedIds.add(row.signal_id);
        failed++;
      }

      if (processed % 100 === 0) {
        console.log(`  ${processed}/${count} processed, ${embedded} embedded, ${failed} failed`);
      }
    }
  }

  if (failedIds.size > 0) {
    console.log(`Skipped ${failedIds.size} signals that failed embedding`);
  }

  console.log(`Done: ${processed} processed, ${embedded} embedded, ${failed} failed`);
  await pool.end();
};

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
