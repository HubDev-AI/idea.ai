import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { ScoringHealthRecord } from '@idea/contracts/src/api';
import type { ActiveWeights } from '../runtime/active_weights';

export type ScoringHealthDeps = {
  pool: Pool;
  getActiveWeights: (profileId: string) => Promise<ActiveWeights>;
};

const HISTORY_LIMIT = 20;

export const registerScoringHealthRoute = (
  app: FastifyInstance,
  deps: ScoringHealthDeps,
): void => {
  app.get('/v1/scoring-health', async (request, reply) => {
    const { profile = 'consumer' } = request.query as { profile?: string };

    // Current weights
    const weights = await deps.getActiveWeights(profile);

    // Optimization history (latest 20)
    let optimizationHistory: ScoringHealthRecord['optimizationHistory'] = [];
    try {
      const { rows } = await deps.pool.query<{
        computed_at: Date;
        demand_weight: number;
        timing_weight: number;
        buildability_weight: number;
        virality_weight: number;
        precision_score: number | null;
        sample_size: number | null;
      }>(
        `SELECT computed_at, demand_weight, timing_weight, buildability_weight, virality_weight,
                precision_score, sample_size
         FROM scoring_weight_history
         WHERE profile_id = $1
         ORDER BY computed_at DESC
         LIMIT $2`,
        [profile, HISTORY_LIMIT],
      );
      optimizationHistory = rows.map((r) => ({
        computedAt: new Date(r.computed_at).toISOString(),
        demand: r.demand_weight,
        timing: r.timing_weight,
        buildability: r.buildability_weight,
        virality: r.virality_weight,
        precision: r.precision_score,
        sampleSize: r.sample_size,
      }));
    } catch {
      // DB not available — empty history
    }

    // Prediction track record
    let predictionTrackRecord: ScoringHealthRecord['predictionTrackRecord'] = {
      total: 0,
      validated: 0,
      accuracy: null,
    };
    try {
      const { rows } = await deps.pool.query<{
        total: string;
        validated: string;
      }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE outcome_validated = true)::text AS validated
         FROM thesis_predictions
         WHERE outcome_checked_at IS NOT NULL`,
      );
      const statsRow = rows[0];
      if (statsRow !== undefined) {
        const total = parseInt(statsRow.total, 10);
        const validated = parseInt(statsRow.validated, 10);
        predictionTrackRecord = {
          total,
          validated,
          accuracy: total > 0 ? Math.round((validated / total) * 1000) / 10 : null,
        };
      }
    } catch {
      // DB not available
    }

    // Experience library size
    let experienceLibrarySize = 0;
    try {
      const { rows } = await deps.pool.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM experience_library`,
      );
      const cntRow = rows[0];
      if (cntRow !== undefined) {
        experienceLibrarySize = parseInt(cntRow.cnt, 10);
      }
    } catch {
      // DB not available
    }

    const result: ScoringHealthRecord = {
      currentWeights: {
        profileId: weights.profileId,
        demand: weights.demand,
        timing: weights.timing,
        buildability: weights.buildability,
        virality: weights.virality,
        source: weights.source,
      },
      optimizationHistory,
      predictionTrackRecord,
      experienceLibrarySize,
    };

    return reply.send(result);
  });
};
