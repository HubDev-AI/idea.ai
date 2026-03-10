import type { AgentRunResult } from '@idea/contracts/src/api';
import type { Pool } from 'pg';

export type AgentRunRow = {
  id: number;
  run_id: string;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  clusters_analyzed: number;
  deep_dives_performed: number;
  theses_updated: number;
  new_candidates: number;
  journal_entries_written: number;
  investigate_next: string | null;
  provider: string | null;
  error_message: string | null;
};

export type AgentRunStore = {
  create(runId: string): Promise<void>;
  complete(runId: string, result: AgentRunResult): Promise<void>;
  fail(runId: string, error: unknown): Promise<void>;
  latest(): Promise<AgentRunRow | null>;
  list(limit?: number): Promise<AgentRunRow[]>;
};

const SAFE_COLUMNS = `id, run_id, status, started_at, finished_at, duration_ms,
  clusters_analyzed, deep_dives_performed, theses_updated, new_candidates,
  journal_entries_written, investigate_next, provider, error_message, created_at`;

export const createAgentRunStore = ({ pool }: { pool: Pool }): AgentRunStore => ({
  async create(runId: string): Promise<void> {
    await pool.query(
      `INSERT INTO agent_runs (run_id, status, started_at) VALUES ($1, 'running', now())`,
      [runId]
    );
  },

  async complete(runId: string, result: AgentRunResult): Promise<void> {
    await pool.query(
      `UPDATE agent_runs SET
        status = 'completed',
        finished_at = now(),
        duration_ms = EXTRACT(EPOCH FROM (now() - started_at))::int * 1000,
        clusters_analyzed = $2,
        deep_dives_performed = $3,
        theses_updated = $4,
        new_candidates = $5,
        journal_entries_written = $6,
        investigate_next = $7,
        provider = $8
      WHERE run_id = $1`,
      [
        runId,
        result.clustersAnalyzed,
        result.deepDivesPerformed,
        result.thesesUpdated,
        result.newCandidates,
        result.journalEntriesWritten,
        result.investigateNext || null,
        result.provider || null
      ]
    );
  },

  async fail(runId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? null : null;
    await pool.query(
      `UPDATE agent_runs SET
        status = 'failed',
        finished_at = now(),
        duration_ms = EXTRACT(EPOCH FROM (now() - started_at))::int * 1000,
        error_message = $2,
        error_stack = $3
      WHERE run_id = $1`,
      [runId, message, stack]
    );
  },

  async latest(): Promise<AgentRunRow | null> {
    const result = await pool.query<AgentRunRow>(
      `SELECT ${SAFE_COLUMNS} FROM agent_runs ORDER BY started_at DESC LIMIT 1`
    );
    return result.rows[0] ?? null;
  },

  async list(limit = 20): Promise<AgentRunRow[]> {
    const result = await pool.query<AgentRunRow>(
      `SELECT ${SAFE_COLUMNS} FROM agent_runs ORDER BY started_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows;
  }
});
