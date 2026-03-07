import type { Pool } from 'pg';
import {
  optimizeWeights,
  computePrecision,
  type ValidatedPrediction,
} from '@idea/pipeline/src/scoring/weight_optimizer';

export type WeightOptDeps = {
  pool: Pool;
  minPredictions: number;
  minImprovement: number;
  gridStep: number;
  profileId?: string;
};

type OptResult = {
  skipped: boolean;
  reason?: string;
  newWeights?: Record<string, number>;
  precision?: number;
  currentPrecision?: number;
};

const CURRENT_WEIGHTS = { demand: 0.25, timing: 0.20, buildability: 0.20, virality: 0.35 };

export const runWeightOptimization = async (deps: WeightOptDeps): Promise<OptResult> => {
  const { rows } = await deps.pool.query<ValidatedPrediction>(
    `SELECT thesis_key, demand_score, timing_score, buildability_score,
            virality_score, velocity, outcome_validated
     FROM thesis_predictions
     WHERE outcome_checked_at IS NOT NULL
       AND demand_score IS NOT NULL`
  );

  if (rows.length < deps.minPredictions) {
    return { skipped: true, reason: `Only ${rows.length}/${deps.minPredictions} predictions available` };
  }

  const currentPrecision = computePrecision(rows, CURRENT_WEIGHTS);
  const { weights, precision } = optimizeWeights(rows, deps.gridStep);
  const improvement = precision - (Number.isNaN(currentPrecision) ? 0 : currentPrecision);

  if (improvement < deps.minImprovement) {
    return {
      skipped: true,
      reason: `Improvement ${(improvement * 100).toFixed(1)}% below threshold ${(deps.minImprovement * 100).toFixed(1)}%`,
      currentPrecision: Number.isNaN(currentPrecision) ? undefined : currentPrecision,
      precision,
    };
  }

  await deps.pool.query(
    `INSERT INTO scoring_weight_history
       (demand_weight, timing_weight, buildability_weight, virality_weight, velocity_weight,
        precision_score, recall_score, sample_size, profile_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [weights.demand, weights.timing, weights.buildability, weights.virality, 0,
     precision, null, rows.length, deps.profileId ?? 'consumer']
  );

  return {
    skipped: false,
    newWeights: weights,
    precision,
    currentPrecision: Number.isNaN(currentPrecision) ? undefined : currentPrecision,
  };
};
