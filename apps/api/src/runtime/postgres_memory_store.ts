import type { SimilarSignalMatch, TrendWindowSnapshot } from '@idea/contracts/src/memory';
import type { MemoryQuery, MemoryRetriever } from '@idea/pipeline/src/memory/retrieve';
import type { Pool, PoolClient } from 'pg';
import pg from 'pg';
import { buildLocalEmbedding } from '../jobs/memory_index';
import type { IndexedMemoryEntry } from '../jobs/memory_retriever';
import type { ExecutionLogger } from './execution_logger';

const { Pool: PgPool } = pg;

const WINDOW_ORDER: TrendWindowSnapshot['window'][] = ['7d', '30d', '90d'];
const WINDOW_INTERVALS: Array<{ window: TrendWindowSnapshot['window']; interval: string }> = [
  { window: '7d', interval: '7 days' },
  { window: '30d', interval: '30 days' },
  { window: '90d', interval: '90 days' }
];

const toVectorLiteral = (embedding: number[]): string =>
  `[${embedding.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}]`;

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return value;
  }

  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toIsoString = (value: unknown): string => new Date(String(value)).toISOString();

const trendWindowsSql = `
WITH windows(window_name, age_interval) AS (
  VALUES
    ('7d'::text, interval '7 days'),
    ('30d'::text, interval '30 days'),
    ('90d'::text, interval '90 days')
)
SELECT
  $1::text AS topic,
  $2::text AS source,
  windows.window_name AS window,
  COUNT(signal_memory.signal_id)::int AS count_signals,
  ROUND(COALESCE(AVG(signal_memory.pain), 0)::numeric, 2) AS avg_pain,
  ROUND(COALESCE(AVG(signal_memory.timing), 0)::numeric, 2) AS avg_timing
FROM windows
LEFT JOIN signal_memory
  ON signal_memory.topic = $1
 AND signal_memory.source = $2
 AND signal_memory.observed_at >= NOW() - windows.age_interval
GROUP BY windows.window_name
ORDER BY CASE windows.window_name
  WHEN '7d' THEN 1
  WHEN '30d' THEN 2
  WHEN '90d' THEN 3
END
`;

type TrendWindowRow = {
  topic: string;
  source: string;
  window: TrendWindowSnapshot['window'];
  count_signals: number;
  avg_pain: number | string;
  avg_timing: number | string;
};

type SimilarRow = {
  signal_id: string;
  distance: number | string;
  pain: number | string;
  timing: number | string;
  source: string;
  observed_at: string | Date;
};

const upsertSignalMemory = async (client: PoolClient, entry: IndexedMemoryEntry): Promise<void> => {
  await client.query(
    `
      INSERT INTO signal_memory (
        signal_id,
        topic,
        source,
        canonical_text,
        observed_at,
        pain,
        timing,
        buildability,
        blended,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (signal_id)
      DO UPDATE SET
        topic = EXCLUDED.topic,
        source = EXCLUDED.source,
        canonical_text = EXCLUDED.canonical_text,
        observed_at = EXCLUDED.observed_at,
        pain = EXCLUDED.pain,
        timing = EXCLUDED.timing,
        buildability = EXCLUDED.buildability,
        blended = EXCLUDED.blended,
        updated_at = NOW()
    `,
    [
      entry.memoryRecord.signal_id,
      entry.memoryRecord.topic,
      entry.memoryRecord.source,
      entry.memoryRecord.canonical_text,
      entry.memoryRecord.observed_at,
      entry.memoryRecord.pain,
      entry.memoryRecord.timing,
      entry.memoryRecord.buildability,
      entry.memoryRecord.blended
    ]
  );

  // Skip embedding storage if Ollama returned null (service unreachable)
  if (entry.embeddingRecord.embedding === null) {
    return;
  }

  await client.query(
    `
      INSERT INTO signal_embeddings (
        signal_id,
        embedding,
        model,
        created_at
      )
      VALUES ($1, $2::vector, $3, NOW())
      ON CONFLICT (signal_id)
      DO UPDATE SET
        embedding = EXCLUDED.embedding,
        model = EXCLUDED.model,
        created_at = NOW()
    `,
    [
      entry.embeddingRecord.signal_id,
      toVectorLiteral(entry.embeddingRecord.embedding),
      entry.embeddingRecord.model
    ]
  );
};

const upsertTrendWindows = async (client: PoolClient, topic: string, source: string): Promise<void> => {
  for (const { window, interval } of WINDOW_INTERVALS) {
    await client.query(
      `
        INSERT INTO trend_windows (
          topic,
          source,
          "window",
          count_signals,
          avg_pain,
          avg_timing,
          updated_at
        )
        SELECT
          $1::text,
          $2::text,
          $3::text,
          COUNT(signal_id)::int,
          ROUND(COALESCE(AVG(pain), 0)::numeric, 2),
          ROUND(COALESCE(AVG(timing), 0)::numeric, 2),
          NOW()
        FROM signal_memory
        WHERE topic = $1
          AND source = $2
          AND observed_at >= NOW() - $4::interval
        ON CONFLICT (topic, source, "window")
        DO UPDATE SET
          count_signals = EXCLUDED.count_signals,
          avg_pain = EXCLUDED.avg_pain,
          avg_timing = EXCLUDED.avg_timing,
          updated_at = NOW()
      `,
      [topic, source, window, interval]
    );
  }
};

const similarSql = `
SELECT
  signal_memory.signal_id,
  LEAST(GREATEST((signal_embeddings.embedding <=> $1::vector)::double precision, 0), 1) AS distance,
  signal_memory.pain,
  signal_memory.timing,
  signal_memory.source,
  signal_memory.observed_at
FROM signal_embeddings
JOIN signal_memory
  ON signal_memory.signal_id = signal_embeddings.signal_id
WHERE signal_memory.topic = $2 OR signal_memory.source = $3
ORDER BY signal_embeddings.embedding <=> $1::vector
LIMIT $4
`;

export type MemorySignalRow = {
  signal_id: string;
  topic: string;
  source: string;
  canonical_text: string;
  observed_at: string;
  pain: number;
  timing: number;
  buildability: number;
  blended: number;
};

export type PostgresMemoryStore = {
  retriever: MemoryRetriever;
  save: (entry: IndexedMemoryEntry) => Promise<void>;
  listAllSignals: (limit?: number) => Promise<MemorySignalRow[]>;
  ping: () => Promise<void>;
  close: () => Promise<void>;
};

export const createPostgresMemoryStore = ({
  databaseUrl,
  logger
}: {
  databaseUrl: string;
  logger?: ExecutionLogger;
}): PostgresMemoryStore => {
  const pool: Pool = new PgPool({
    connectionString: databaseUrl,
    max: 8,
    idleTimeoutMillis: 30_000
  });

  const ping = async (): Promise<void> => {
    await pool.query('SELECT 1');
  };

  const save = async (entry: IndexedMemoryEntry): Promise<void> => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await upsertSignalMemory(client, entry);
      await upsertTrendWindows(client, entry.memoryRecord.topic, entry.memoryRecord.source);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      await logger?.error('postgres_memory_store', 'persist failed', {
        signal_id: entry.memoryRecord.signal_id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    } finally {
      client.release();
    }
  };

  const retriever: MemoryRetriever = {
    findSimilar: async (query: MemoryQuery): Promise<SimilarSignalMatch[]> => {
      const limit = query.topK ?? 8;
      const queryEmbedding = buildLocalEmbedding(query.canonicalText);
      const result = await pool.query<SimilarRow>(similarSql, [
        toVectorLiteral(queryEmbedding),
        query.topic,
        query.source,
        limit
      ]);

      return result.rows.map((row) => ({
        signal_id: row.signal_id,
        distance: Math.round(toNumber(row.distance) * 10000) / 10000,
        pain: toNumber(row.pain),
        timing: toNumber(row.timing),
        source: row.source,
        observed_at: toIsoString(row.observed_at)
      }));
    },
    getTrendWindows: async (query: MemoryQuery): Promise<TrendWindowSnapshot[]> => {
      const result = await pool.query<TrendWindowRow>(trendWindowsSql, [query.topic, query.source]);
      const rowByWindow = new Map(result.rows.map((row) => [row.window, row] as const));

      return WINDOW_ORDER.map((window) => {
        const row = rowByWindow.get(window);

        if (!row) {
          return {
            topic: query.topic,
            source: query.source,
            window,
            count_signals: 0,
            avg_pain: 0,
            avg_timing: 0
          };
        }

        return {
          topic: row.topic,
          source: row.source,
          window: row.window,
          count_signals: toNumber(row.count_signals),
          avg_pain: toNumber(row.avg_pain),
          avg_timing: toNumber(row.avg_timing)
        };
      });
    }
  };

  const listAllSignals = async (limit = 500): Promise<MemorySignalRow[]> => {
    const result = await pool.query<{
      signal_id: string;
      topic: string;
      source: string;
      canonical_text: string;
      observed_at: Date;
      pain: unknown;
      timing: unknown;
      buildability: unknown;
      blended: unknown;
    }>(
      `SELECT signal_id, topic, source, canonical_text, observed_at, pain, timing, buildability, blended
       FROM signal_memory
       ORDER BY observed_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row) => ({
      signal_id: row.signal_id,
      topic: row.topic,
      source: row.source,
      canonical_text: row.canonical_text,
      observed_at: toIsoString(row.observed_at),
      pain: toNumber(row.pain),
      timing: toNumber(row.timing),
      buildability: toNumber(row.buildability),
      blended: toNumber(row.blended)
    }));
  };

  return {
    retriever,
    save,
    listAllSignals,
    ping,
    close: async () => {
      await pool.end();
    }
  };
};
