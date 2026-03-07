import type { SimilarSignalMatch, TrendWindowSnapshot } from '@idea/contracts/src/memory';
import type { MemoryQuery, MemoryRetriever } from '@idea/pipeline/src/memory/retrieve';
import type { Pool, PoolClient } from 'pg';
import pg from 'pg';
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
  COUNT(scored_signals.signal_id)::int AS count_signals,
  ROUND(COALESCE(AVG(scored_signals.demand), 0)::numeric, 2) AS avg_demand,
  ROUND(COALESCE(AVG(scored_signals.timing), 0)::numeric, 2) AS avg_timing
FROM windows
LEFT JOIN scored_signals
  ON scored_signals.topic = $1
 AND scored_signals.source = $2
 AND scored_signals.observed_at >= NOW() - windows.age_interval
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
  avg_demand: number | string;
  avg_timing: number | string;
};

type SimilarRow = {
  signal_id: string;
  distance: number | string;
  demand: number | string;
  timing: number | string;
  source: string;
  observed_at: string | Date;
  canonical_text: string;
};

const upsertSignalMemory = async (client: PoolClient, entry: IndexedMemoryEntry): Promise<void> => {
  await client.query(
    `
      INSERT INTO scored_signals (
        signal_id,
        topic,
        source,
        canonical_text,
        observed_at,
        demand,
        timing,
        buildability,
        blended,
        virality,
        source_url,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (signal_id)
      DO UPDATE SET
        topic = EXCLUDED.topic,
        source = EXCLUDED.source,
        canonical_text = EXCLUDED.canonical_text,
        observed_at = EXCLUDED.observed_at,
        demand = EXCLUDED.demand,
        timing = EXCLUDED.timing,
        buildability = EXCLUDED.buildability,
        blended = EXCLUDED.blended,
        virality = EXCLUDED.virality,
        source_url = COALESCE(EXCLUDED.source_url, scored_signals.source_url),
        updated_at = NOW()
    `,
    [
      entry.memoryRecord.signal_id,
      entry.memoryRecord.topic,
      entry.memoryRecord.source,
      entry.memoryRecord.canonical_text,
      entry.memoryRecord.observed_at,
      entry.memoryRecord.demand,
      entry.memoryRecord.timing,
      entry.memoryRecord.buildability,
      entry.memoryRecord.blended,
      entry.memoryRecord.virality,
      entry.memoryRecord.source_url ?? null
    ]
  );

  // Skip embedding storage if Ollama was unreachable
  if (!entry.embeddingRecord || entry.embeddingRecord.embedding === null) {
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
          avg_demand,
          avg_timing,
          updated_at
        )
        SELECT
          $1::text,
          $2::text,
          $3::text,
          COUNT(signal_id)::int,
          ROUND(COALESCE(AVG(demand), 0)::numeric, 2),
          ROUND(COALESCE(AVG(timing), 0)::numeric, 2),
          NOW()
        FROM scored_signals
        WHERE topic = $1
          AND source = $2
          AND observed_at >= NOW() - $4::interval
        ON CONFLICT (topic, source, "window")
        DO UPDATE SET
          count_signals = EXCLUDED.count_signals,
          avg_demand = EXCLUDED.avg_demand,
          avg_timing = EXCLUDED.avg_timing,
          updated_at = NOW()
      `,
      [topic, source, window, interval]
    );
  }
};

const similarSql = `
SELECT
  scored_signals.signal_id,
  LEAST(GREATEST((signal_embeddings.embedding <=> $1::vector)::double precision, 0), 1) AS distance,
  scored_signals.demand,
  scored_signals.timing,
  scored_signals.source,
  scored_signals.observed_at,
  scored_signals.canonical_text
FROM signal_embeddings
JOIN scored_signals
  ON scored_signals.signal_id = signal_embeddings.signal_id
WHERE scored_signals.topic = $2 OR scored_signals.source = $3
ORDER BY signal_embeddings.embedding <=> $1::vector
LIMIT $4
`;

export type MemorySignalRow = {
  signal_id: string;
  topic: string;
  source: string;
  canonical_text: string;
  observed_at: string;
  demand: number;
  timing: number;
  buildability: number;
  blended: number;
  virality: number;
  source_url: string | null;
};

export type SignalQueryResult = {
  items: MemorySignalRow[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type SignalSortField = 'score' | 'newest' | 'virality' | 'demand';

export type SignalQueryParams = {
  windowDays: number;
  page: number;
  pageSize: number;
  source?: string;
  thesisKey?: string;
  sort?: SignalSortField;
};

export type EmbeddingStats = {
  total: number;
  withEmbedding: number;
  fallbackModel: string;
  dataSizeMb: number;
};

export type ConvergentMatch = {
  signal_id: string;
  source: string;
  distance: number;
};

export type RefreshState = {
  lastHourlyRunAt: number;
  lastDailyRunAt: number;
  refreshedAt: number;
};

export type ConnectorStateRow = {
  connector_name: string;
  status: string;
  last_run_at: string | null;
  last_error: string | null;
  cadence: string | null;
};

export type PostgresSignalStore = {
  retriever: MemoryRetriever;
  save: (entry: IndexedMemoryEntry) => Promise<void>;
  listAllSignals: (limit?: number) => Promise<MemorySignalRow[]>;
  querySignals: (params: SignalQueryParams) => Promise<SignalQueryResult>;
  countSignalsBySource: () => Promise<Record<string, number>>;
  getEmbeddings: (signalIds: string[]) => Promise<Map<string, number[]>>;
  getEmbeddingStats: () => Promise<EmbeddingStats>;
  findConvergentSignals: (signalId: string, embedding: number[], source: string) => Promise<ConvergentMatch[]>;
  boostViralityScore: (signalId: string, boost: number) => Promise<void>;
  listSignalsWithoutEmbeddings: (limit: number) => Promise<{ signal_id: string; canonical_text: string }[]>;
  saveEmbedding: (signalId: string, embedding: number[], model: string) => Promise<void>;
  loadRefreshState: () => Promise<RefreshState>;
  saveRefreshState: (state: RefreshState) => Promise<void>;
  upsertConnectorState: (name: string, status: string, cadence: string | null, error?: string | null) => Promise<void>;
  listConnectorStates: () => Promise<ConnectorStateRow[]>;
  getSignalCount: () => Promise<number>;
  getLatestSignalAt: () => Promise<string | null>;
  ping: () => Promise<void>;
  close: () => Promise<void>;
};

export const createPostgresSignalStore = ({
  databaseUrl,
  logger,
  embedText
}: {
  databaseUrl: string;
  logger?: ExecutionLogger;
  embedText?: (text: string) => Promise<number[] | null>;
}): PostgresSignalStore => {
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
      await logger?.error('postgres_signal_store', 'persist failed', {
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
      const queryEmbedding = embedText
        ? await embedText(query.canonicalText)
        : null;
      if (!queryEmbedding) return [];
      const result = await pool.query<SimilarRow>(similarSql, [
        toVectorLiteral(queryEmbedding),
        query.topic,
        query.source,
        limit
      ]);

      return result.rows.map((row) => ({
        signal_id: row.signal_id,
        distance: Math.round(toNumber(row.distance) * 10000) / 10000,
        demand: toNumber(row.demand),
        timing: toNumber(row.timing),
        source: row.source,
        observed_at: toIsoString(row.observed_at),
        canonical_text: row.canonical_text
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
            avg_demand: 0,
            avg_timing: 0
          };
        }

        return {
          topic: row.topic,
          source: row.source,
          window: row.window,
          count_signals: toNumber(row.count_signals),
          avg_demand: toNumber(row.avg_demand),
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
      demand: unknown;
      timing: unknown;
      buildability: unknown;
      blended: unknown;
      virality: unknown;
      source_url: string | null;
    }>(
      `SELECT signal_id, topic, source, canonical_text, observed_at, demand, timing, buildability, blended, virality, source_url
       FROM scored_signals
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
      demand: toNumber(row.demand),
      timing: toNumber(row.timing),
      buildability: toNumber(row.buildability),
      blended: toNumber(row.blended),
      virality: toNumber(row.virality),
      source_url: row.source_url ?? null
    }));
  };

  const sortClause = (sort: SignalSortField | undefined): string => {
    switch (sort) {
      case 'newest': return 'ORDER BY sm.observed_at DESC';
      case 'virality': return 'ORDER BY sm.virality DESC';
      case 'demand': return 'ORDER BY sm.demand DESC';
      default: return 'ORDER BY sm.blended DESC';
    }
  };

  const querySignals = async (params: SignalQueryParams): Promise<SignalQueryResult> => {
    const { windowDays, page, pageSize, source, thesisKey, sort } = params;
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    conditions.push(`sm.observed_at >= NOW() - INTERVAL '1 day' * $${paramIdx++}`);
    values.push(windowDays);

    if (source) {
      conditions.push(`sm.source = $${paramIdx++}`);
      values.push(source);
    }

    let joinClause = '';
    if (thesisKey) {
      joinClause = `
        JOIN thesis_evidence te ON te.signal_id = sm.signal_id
        JOIN thesis_candidates tc ON tc.id = te.thesis_id`;
      conditions.push(`tc.canonical_key = $${paramIdx++}`);
      values.push(thesisKey);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(DISTINCT sm.signal_id)::int AS count FROM scored_signals sm ${joinClause} ${whereClause}`;
    const countResult = await pool.query<{ count: number }>(countSql, values);
    const totalItems = countResult.rows[0]?.count ?? 0;

    const offset = (page - 1) * pageSize;
    const limitIdx = paramIdx++;
    const offsetIdx = paramIdx++;
    const dataSql = `
      SELECT DISTINCT sm.signal_id, sm.topic, sm.source, sm.canonical_text,
             sm.observed_at, sm.demand, sm.timing, sm.buildability, sm.blended, sm.virality, sm.source_url
      FROM scored_signals sm ${joinClause} ${whereClause}
      ${sortClause(sort)}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    const dataResult = await pool.query<Record<string, unknown>>(dataSql, [...values, pageSize, offset]);

    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const items: MemorySignalRow[] = dataResult.rows.map((row) => ({
      signal_id: String(row.signal_id ?? ''),
      topic: String(row.topic ?? ''),
      source: String(row.source ?? ''),
      canonical_text: String(row.canonical_text ?? ''),
      observed_at: toIsoString(row.observed_at),
      demand: toNumber(row.demand),
      timing: toNumber(row.timing),
      buildability: toNumber(row.buildability),
      blended: toNumber(row.blended),
      virality: toNumber(row.virality),
      source_url: row.source_url ? String(row.source_url) : null,
    }));

    return { items, page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 };
  };

  const countSignalsBySource = async (): Promise<Record<string, number>> => {
    const result = await pool.query<{ source: string; count: number }>(
      'SELECT source, COUNT(*)::int AS count FROM scored_signals GROUP BY source'
    );
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.source] = row.count;
    }
    return counts;
  };

  const getEmbeddings = async (signalIds: string[]): Promise<Map<string, number[]>> => {
    if (signalIds.length === 0) return new Map();
    const placeholders = signalIds.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query<{ signal_id: string; embedding: string }>(
      `SELECT signal_id, embedding::text FROM signal_embeddings WHERE signal_id IN (${placeholders})`,
      signalIds
    );
    const map = new Map<string, number[]>();
    for (const row of result.rows) {
      // pgvector returns embedding as "[0.1,0.2,...]" string
      const nums = row.embedding
        .replace(/^\[/, '').replace(/\]$/, '')
        .split(',')
        .map(Number)
        .filter(Number.isFinite);
      if (nums.length > 0) {
        map.set(row.signal_id, nums);
      }
    }
    return map;
  };

  const getEmbeddingStats = async (): Promise<EmbeddingStats> => {
    const result = await pool.query<{ total: number; with_embedding: number; fallback_model: string | null; data_size_mb: number }>(`
      SELECT
        (SELECT COUNT(*)::int FROM scored_signals) AS total,
        (SELECT COUNT(*)::int FROM signal_embeddings) AS with_embedding,
        (SELECT model FROM signal_embeddings ORDER BY created_at DESC LIMIT 1) AS fallback_model,
        (SELECT ROUND(pg_total_relation_size('signal_embeddings') / 1024.0 / 1024.0, 1)::float) AS data_size_mb
    `);
    const row = result.rows[0];
    return {
      total: row?.total ?? 0,
      withEmbedding: row?.with_embedding ?? 0,
      fallbackModel: row?.fallback_model ?? 'none',
      dataSizeMb: row?.data_size_mb ?? 0
    };
  };

  const convergentSql = `
    SELECT
      sm.signal_id,
      sm.source,
      LEAST(GREATEST((se.embedding <=> $1::vector)::double precision, 0), 1) AS distance
    FROM signal_embeddings se
    JOIN scored_signals sm ON sm.signal_id = se.signal_id
    WHERE sm.signal_id != $2
      AND sm.source != $3
      AND sm.observed_at >= NOW() - INTERVAL '48 hours'
      AND (se.embedding <=> $1::vector) < 0.35
    ORDER BY se.embedding <=> $1::vector
    LIMIT 5
  `;

  const findConvergentSignals = async (
    signalId: string,
    embedding: number[],
    source: string
  ): Promise<ConvergentMatch[]> => {
    const result = await pool.query<{ signal_id: string; source: string; distance: number | string }>(
      convergentSql,
      [toVectorLiteral(embedding), signalId, source]
    );

    return result.rows.map((row) => ({
      signal_id: row.signal_id,
      source: row.source,
      distance: toNumber(row.distance)
    }));
  };

  const boostViralityScore = async (signalId: string, boost: number): Promise<void> => {
    await pool.query(
      `UPDATE scored_signals
       SET virality = LEAST(100, virality + $2),
           blended = ROUND((0.25 * demand + 0.20 * timing + 0.20 * buildability + 0.35 * LEAST(100, virality + $2))::numeric, 2),
           updated_at = NOW()
       WHERE signal_id = $1`,
      [signalId, boost]
    );
  };

  const listSignalsWithoutEmbeddings = async (limit: number): Promise<{ signal_id: string; canonical_text: string }[]> => {
    const result = await pool.query<{ signal_id: string; canonical_text: string }>(
      `SELECT sm.signal_id, sm.canonical_text
       FROM scored_signals sm
       LEFT JOIN signal_embeddings se ON se.signal_id = sm.signal_id
       WHERE se.signal_id IS NULL
       ORDER BY sm.observed_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  };

  const saveEmbedding = async (signalId: string, embedding: number[], model: string): Promise<void> => {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO signal_embeddings (signal_id, embedding, model, created_at)
         VALUES ($1, $2::vector, $3, NOW())
         ON CONFLICT (signal_id)
         DO UPDATE SET embedding = EXCLUDED.embedding, model = EXCLUDED.model, created_at = NOW()`,
        [signalId, toVectorLiteral(embedding), model]
      );
    } finally {
      client.release();
    }
  };

  const loadRefreshState = async (): Promise<RefreshState> => {
    const result = await pool.query<{
      last_hourly_run_at: Date | null;
      last_daily_run_at: Date | null;
      refreshed_at: Date | null;
    }>('SELECT last_hourly_run_at, last_daily_run_at, refreshed_at FROM refresh_state WHERE id = 1');
    const row = result.rows[0];
    if (!row) return { lastHourlyRunAt: 0, lastDailyRunAt: 0, refreshedAt: 0 };
    return {
      lastHourlyRunAt: row.last_hourly_run_at ? row.last_hourly_run_at.getTime() : 0,
      lastDailyRunAt: row.last_daily_run_at ? row.last_daily_run_at.getTime() : 0,
      refreshedAt: row.refreshed_at ? row.refreshed_at.getTime() : 0,
    };
  };

  const saveRefreshState = async (state: RefreshState): Promise<void> => {
    await pool.query(
      `INSERT INTO refresh_state (id, last_hourly_run_at, last_daily_run_at, refreshed_at, updated_at)
       VALUES (1, $1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET
         last_hourly_run_at = EXCLUDED.last_hourly_run_at,
         last_daily_run_at = EXCLUDED.last_daily_run_at,
         refreshed_at = EXCLUDED.refreshed_at,
         updated_at = NOW()`,
      [
        state.lastHourlyRunAt > 0 ? new Date(state.lastHourlyRunAt).toISOString() : null,
        state.lastDailyRunAt > 0 ? new Date(state.lastDailyRunAt).toISOString() : null,
        state.refreshedAt > 0 ? new Date(state.refreshedAt).toISOString() : null,
      ]
    );
  };

  const upsertConnectorState = async (
    name: string, status: string, cadence: string | null, error?: string | null
  ): Promise<void> => {
    await pool.query(
      `INSERT INTO connector_state (connector_name, status, last_run_at, last_error, cadence, updated_at)
       VALUES ($1, $2, NOW(), $3, $4, NOW())
       ON CONFLICT (connector_name)
       DO UPDATE SET status = $2, last_run_at = NOW(), last_error = $3, cadence = $4, updated_at = NOW()`,
      [name, status, error ?? null, cadence]
    );
  };

  const listConnectorStates = async (): Promise<ConnectorStateRow[]> => {
    const result = await pool.query<ConnectorStateRow>(
      `SELECT connector_name, status, last_run_at::text, last_error, cadence FROM connector_state ORDER BY connector_name`
    );
    return result.rows;
  };

  const getSignalCount = async (): Promise<number> => {
    const result = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM scored_signals`);
    return result.rows[0]?.count ?? 0;
  };

  const getLatestSignalAt = async (): Promise<string | null> => {
    const result = await pool.query<{ latest: string | null }>(
      `SELECT MAX(updated_at)::text AS latest FROM scored_signals`
    );
    return result.rows[0]?.latest ?? null;
  };

  return {
    retriever,
    save,
    listAllSignals,
    querySignals,
    countSignalsBySource,
    getEmbeddings,
    getEmbeddingStats,
    findConvergentSignals,
    boostViralityScore,
    listSignalsWithoutEmbeddings,
    saveEmbedding,
    loadRefreshState,
    saveRefreshState,
    upsertConnectorState,
    listConnectorStates,
    getSignalCount,
    getLatestSignalAt,
    ping,
    close: async () => {
      await pool.end();
    }
  };
};
