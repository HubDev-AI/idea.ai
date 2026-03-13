import type { Pool } from 'pg';
import pg from 'pg';
import { toVectorLiteral } from './db_utils';

const { Pool: PgPool } = pg;

export type JournalEntryType = 'trend_shift' | 'emerging_pattern' | 'thesis_evolution' | 'market_signal' | 'run_summary';

export type JournalEntry = {
  id?: number;
  run_id: string;
  entry_type: JournalEntryType;
  topic: string;
  insight: string;
  narrative: string | null;
  confidence: number;
  thesis_keys: string[];
  signal_ids: string[];
  embedding: number[] | null;
  created_at?: string;
};

export interface JournalStore {
  write(entries: JournalEntry[]): Promise<void>;
  recent(limit: number): Promise<JournalEntry[]>;
  byType(type: JournalEntryType, limit: number): Promise<JournalEntry[]>;
  byThesisKey(key: string, limit: number): Promise<JournalEntry[]>;
  findSimilar(embedding: number[], topK: number): Promise<JournalEntry[]>;
  count(): Promise<number>;
  close(): Promise<void>;
}

const toNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};


const rowToEntry = (row: Record<string, unknown>): JournalEntry => {
  const createdAt = row.created_at ? new Date(String(row.created_at)).toISOString() : undefined;
  return {
    id: toNumber(row.id),
    run_id: String(row.run_id ?? ''),
    entry_type: String(row.entry_type ?? 'run_summary') as JournalEntryType,
    topic: String(row.topic ?? ''),
    insight: String(row.insight ?? ''),
    narrative: row.narrative != null ? String(row.narrative) : null,
    confidence: toNumber(row.confidence),
    thesis_keys: Array.isArray(row.thesis_keys) ? row.thesis_keys.map(String) : [],
    signal_ids: Array.isArray(row.signal_ids) ? row.signal_ids.map(String) : [],
    embedding: null, // Don't return embedding blobs in queries
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
  };
};

export const createPostgresJournalStore = ({
  databaseUrl
}: {
  databaseUrl: string;
}): JournalStore => {
  const pool: Pool = new PgPool({
    connectionString: databaseUrl,
    max: 4,
    idleTimeoutMillis: 30_000
  });

  return {
    async write(entries: JournalEntry[]): Promise<void> {
      for (const entry of entries) {
        const embeddingParam = entry.embedding
          ? toVectorLiteral(entry.embedding)
          : null;
        await pool.query(
          `INSERT INTO agent_journal
            (run_id, entry_type, topic, insight, narrative, confidence, thesis_keys, signal_ids, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)`,
          [
            entry.run_id,
            entry.entry_type,
            entry.topic,
            entry.insight,
            entry.narrative,
            entry.confidence,
            entry.thesis_keys,
            entry.signal_ids,
            embeddingParam
          ]
        );
      }
    },

    async recent(limit: number): Promise<JournalEntry[]> {
      const result = await pool.query(
        `SELECT id, run_id, entry_type, topic, insight, narrative, confidence,
                thesis_keys, signal_ids, created_at
         FROM agent_journal
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );
      return result.rows.map(rowToEntry);
    },

    async byType(type: JournalEntryType, limit: number): Promise<JournalEntry[]> {
      const result = await pool.query(
        `SELECT id, run_id, entry_type, topic, insight, narrative, confidence,
                thesis_keys, signal_ids, created_at
         FROM agent_journal
         WHERE entry_type = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [type, limit]
      );
      return result.rows.map(rowToEntry);
    },

    async byThesisKey(key: string, limit: number): Promise<JournalEntry[]> {
      const result = await pool.query(
        `SELECT id, run_id, entry_type, topic, insight, narrative, confidence,
                thesis_keys, signal_ids, created_at
         FROM agent_journal
         WHERE $1 = ANY(thesis_keys)
         ORDER BY created_at DESC
         LIMIT $2`,
        [key, limit]
      );
      return result.rows.map(rowToEntry);
    },

    async findSimilar(embedding: number[], topK: number): Promise<JournalEntry[]> {
      const result = await pool.query(
        `SELECT id, run_id, entry_type, topic, insight, narrative, confidence,
                thesis_keys, signal_ids, created_at
         FROM agent_journal
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        [toVectorLiteral(embedding), topK]
      );
      return result.rows.map(rowToEntry);
    },

    async count(): Promise<number> {
      const result = await pool.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM agent_journal'
      );
      return result.rows[0]?.count ?? 0;
    },

    async close(): Promise<void> {
      await pool.end();
    }
  };
};
