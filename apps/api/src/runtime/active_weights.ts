import type { Pool } from 'pg';

export type ActiveWeights = {
  profileId: string;
  demand: number;
  timing: number;
  buildability: number;
  virality: number;
  source: 'optimized' | 'default';
};

export const PROFILE_DEFAULT_WEIGHTS: Record<string, Omit<ActiveWeights, 'profileId' | 'source'>> = {
  consumer: { demand: 0.25, timing: 0.20, buildability: 0.20, virality: 0.35 },
  b2b: { demand: 0.30, timing: 0.25, buildability: 0.25, virality: 0.20 },
};

/**
 * Load the latest optimized weights from scoring_weight_history.
 * Falls back to profile defaults when no optimized row exists or on DB error.
 */
export const getActiveWeights = async (
  pool: Pool,
  profileId: string,
): Promise<ActiveWeights> => {
  try {
    const { rows } = await pool.query<{
      demand_weight: number;
      timing_weight: number;
      buildability_weight: number;
      virality_weight: number;
    }>(
      `SELECT demand_weight, timing_weight, buildability_weight, virality_weight
       FROM scoring_weight_history
       WHERE profile_id = $1
       ORDER BY computed_at DESC
       LIMIT 1`,
      [profileId],
    );

    const row = rows[0];
    if (row !== undefined) {
      return {
        profileId,
        demand: row.demand_weight,
        timing: row.timing_weight,
        buildability: row.buildability_weight,
        virality: row.virality_weight,
        source: 'optimized',
      };
    }
  } catch {
    // DB error — fall through to defaults
  }

  const defaults = PROFILE_DEFAULT_WEIGHTS[profileId] ?? PROFILE_DEFAULT_WEIGHTS['consumer']!;
  return {
    profileId,
    demand: defaults.demand,
    timing: defaults.timing,
    buildability: defaults.buildability,
    virality: defaults.virality,
    source: 'default',
  };
};
