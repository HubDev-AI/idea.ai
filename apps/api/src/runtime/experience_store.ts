import type { Pool } from 'pg';

export type ExperienceEntry = {
  id?: number;
  thesis_key: string;
  signal_summary: string;
  reasoning_trajectory: string;
  thesis_output: string;
  outcome_validated: boolean;
  validation_details?: Record<string, unknown>;
  confidence_at_creation: number;
  confidence_at_validation?: number;
  embedding?: number[];
};

export type ExperienceStore = {
  insert(entry: Omit<ExperienceEntry, 'id'>): Promise<void>;
  listValidated(limit: number): Promise<ExperienceEntry[]>;
  listFailed(limit: number): Promise<ExperienceEntry[]>;
  findSimilar(embedding: number[], limit: number): Promise<ExperienceEntry[]>;
};

export const createExperienceStore = (deps: { pool: Pool }): ExperienceStore => ({
  async insert(entry) {
    const embeddingVal = entry.embedding
      ? `[${entry.embedding.join(',')}]`
      : null;

    await deps.pool.query(
      `INSERT INTO experience_library
         (thesis_key, signal_summary, reasoning_trajectory, thesis_output,
          outcome_validated, validation_details, confidence_at_creation,
          confidence_at_validation, embedding, validated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10)`,
      [
        entry.thesis_key,
        entry.signal_summary,
        entry.reasoning_trajectory,
        entry.thesis_output,
        entry.outcome_validated,
        entry.validation_details ? JSON.stringify(entry.validation_details) : null,
        entry.confidence_at_creation,
        entry.confidence_at_validation ?? null,
        embeddingVal,
        entry.outcome_validated ? new Date().toISOString() : null,
      ]
    );
  },

  async listValidated(limit) {
    const { rows } = await deps.pool.query<ExperienceEntry>(
      `SELECT id, thesis_key, signal_summary, reasoning_trajectory, thesis_output,
              outcome_validated, confidence_at_creation, confidence_at_validation
       FROM experience_library
       WHERE outcome_validated = TRUE
       ORDER BY validated_at DESC
       LIMIT $1`,
      [limit]
    );
    return rows;
  },

  async listFailed(limit) {
    const { rows } = await deps.pool.query<ExperienceEntry>(
      `SELECT id, thesis_key, signal_summary, reasoning_trajectory, thesis_output,
              outcome_validated, validation_details, confidence_at_creation
       FROM experience_library
       WHERE outcome_validated = FALSE
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return rows;
  },

  async findSimilar(embedding, limit) {
    const embStr = `[${embedding.join(',')}]`;
    const { rows } = await deps.pool.query<ExperienceEntry>(
      `SELECT id, thesis_key, signal_summary, reasoning_trajectory, thesis_output,
              outcome_validated, confidence_at_creation, confidence_at_validation
       FROM experience_library
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [embStr, limit]
    );
    return rows;
  },
});
