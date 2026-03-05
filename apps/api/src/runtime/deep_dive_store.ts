import type { ThesisDeepDive } from '@idea/contracts/src/api';
import type { Pool } from 'pg';

type DeepDiveRow = {
  canonical_key: string;
  summary: string;
  how_it_works: string;
  growth_strategy: string;
  build_suggestions: string;
  generated_by: string;
  created_at: Date;
};

const rowToDeepDive = (row: DeepDiveRow): ThesisDeepDive => ({
  canonicalKey: row.canonical_key,
  summary: row.summary,
  howItWorks: row.how_it_works,
  growthStrategy: row.growth_strategy,
  buildSuggestions: row.build_suggestions,
  generatedBy: row.generated_by,
  createdAt: row.created_at.toISOString(),
});

export type DeepDiveStore = {
  getByKey(canonicalKey: string): Promise<ThesisDeepDive | null>;
  save(canonicalKey: string, data: {
    summary: string;
    howItWorks: string;
    growthStrategy: string;
    buildSuggestions: string;
    generatedBy: string;
  }): Promise<ThesisDeepDive>;
};

export const createDeepDiveStore = ({ pool }: { pool: Pool }): DeepDiveStore => ({
  async getByKey(canonicalKey: string): Promise<ThesisDeepDive | null> {
    const result = await pool.query<DeepDiveRow>(
      'SELECT * FROM thesis_deep_dives WHERE canonical_key = $1',
      [canonicalKey]
    );
    return result.rows[0] ? rowToDeepDive(result.rows[0]) : null;
  },

  async save(canonicalKey, data): Promise<ThesisDeepDive> {
    const result = await pool.query<DeepDiveRow>(
      `INSERT INTO thesis_deep_dives
        (canonical_key, summary, how_it_works, growth_strategy, build_suggestions, generated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (canonical_key) DO UPDATE SET
         summary = EXCLUDED.summary,
         how_it_works = EXCLUDED.how_it_works,
         growth_strategy = EXCLUDED.growth_strategy,
         build_suggestions = EXCLUDED.build_suggestions,
         generated_by = EXCLUDED.generated_by,
         created_at = NOW()
       RETURNING *`,
      [canonicalKey, data.summary, data.howItWorks, data.growthStrategy, data.buildSuggestions, data.generatedBy]
    );
    return rowToDeepDive(result.rows[0]);
  },
});
