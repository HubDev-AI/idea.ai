import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { ThesisExplainRecord } from '@idea/contracts/src/api';
import type { ThesisStore } from '../runtime/thesis_store';
import { getProfile } from '../profiles/index.js';

/** Default consumer weights (demand/timing/buildability/virality) */
const DEFAULT_CONSUMER_WEIGHTS = {
  demand: 0.25,
  timing: 0.20,
  buildability: 0.20,
  virality: 0.35,
} as const;

/** Default B2B weights mapped onto the same four generic dimension names */
const DEFAULT_B2B_WEIGHTS = {
  demand: 0.30,
  timing: 0.25,
  buildability: 0.25,
  virality: 0.20,
} as const;

type Weights = { demand: number; timing: number; buildability: number; virality: number };
type WeightLabels = { demand: string; timing: string; buildability: string; virality: string };
type ActiveWeights = Weights & { source?: 'optimized' | 'default' };

/**
 * Resolve the four canonical weights for the given profile id.
 * `getActiveWeights` is an optional dependency injected by Slice 2
 * (self-improving weight optimizer). When absent we fall back to
 * static profile defaults.
 */
const resolveWeightLabels = (profileId: string): WeightLabels => {
  const defaults: WeightLabels = {
    demand: 'Demand',
    timing: 'Timing',
    buildability: 'Buildability',
    virality: 'Virality',
  };

  const profile = getProfile(profileId);
  if (!profile) return defaults;

  const dims = profile.scoring.dimensions;
  const labels: Partial<WeightLabels> = {};
  const canonicalNames: (keyof WeightLabels)[] = ['demand', 'timing', 'buildability', 'virality'];
  for (let i = 0; i < Math.min(dims.length, canonicalNames.length); i += 1) {
    labels[canonicalNames[i]] = dims[i].name
      .split('_')
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(' ');
  }

  return {
    demand: labels.demand ?? defaults.demand,
    timing: labels.timing ?? defaults.timing,
    buildability: labels.buildability ?? defaults.buildability,
    virality: labels.virality ?? defaults.virality,
  };
};

const resolveWeights = async (
  profileId: string,
  getActiveWeights?: (profileId: string) => Promise<ActiveWeights | null>,
): Promise<{ weights: Weights; labels: WeightLabels; source: 'optimized' | 'default' }> => {
  if (getActiveWeights) {
    const active = await getActiveWeights(profileId);
    if (active) {
      return {
        weights: {
          demand: active.demand,
          timing: active.timing,
          buildability: active.buildability,
          virality: active.virality,
        },
        labels: resolveWeightLabels(profileId),
        source: active.source ?? 'optimized',
      };
    }
  }

  // Fall back to profile definition or static defaults
  const profile = getProfile(profileId);
  if (profile) {
    const dims = profile.scoring.dimensions;
    const w: Partial<Weights> = {};
    // Map the first four dimensions onto canonical names in order
    const canonicalNames: (keyof Weights)[] = ['demand', 'timing', 'buildability', 'virality'];
    for (let i = 0; i < Math.min(dims.length, 4); i++) {
      w[canonicalNames[i]] = dims[i].weight;
    }
    return {
      weights: {
        demand: w.demand ?? DEFAULT_CONSUMER_WEIGHTS.demand,
        timing: w.timing ?? DEFAULT_CONSUMER_WEIGHTS.timing,
        buildability: w.buildability ?? DEFAULT_CONSUMER_WEIGHTS.buildability,
        virality: w.virality ?? DEFAULT_CONSUMER_WEIGHTS.virality,
      },
      labels: resolveWeightLabels(profileId),
      source: 'default',
    };
  }

  const defaults = profileId === 'b2b' ? DEFAULT_B2B_WEIGHTS : DEFAULT_CONSUMER_WEIGHTS;
  return { weights: { ...defaults }, labels: resolveWeightLabels(profileId), source: 'default' };
};

export type ThesisExplainDeps = {
  store: ThesisStore;
  pool?: Pool | null;
  getActiveWeights?: (profileId: string) => Promise<ActiveWeights | null>;
};

export const registerThesisExplainRoute = (
  app: FastifyInstance,
  deps: ThesisExplainDeps,
): void => {
  app.get('/v1/theses/:key/explain', {
    schema: {
      params: {
        type: 'object',
        properties: { key: { type: 'string', minLength: 1, maxLength: 200 } },
        required: ['key'],
      },
    },
  }, async (request, reply) => {
    const { key } = request.params as { key: string };

    const thesis = await deps.store.getByKey(key);
    if (!thesis) {
      reply.code(404);
      return { error: 'Thesis not found' };
    }

    const profileId = thesis.profileId ?? 'consumer';
    const { weights, labels, source } = await resolveWeights(profileId, deps.getActiveWeights);

    // -- Weight breakdown --
    const demandContrib = thesis.avgDemand * weights.demand;
    const timingContrib = thesis.avgTiming * weights.timing;
    const buildContrib = thesis.avgBuildability * weights.buildability;
    const viralContrib = thesis.avgVirality * weights.virality;
    const blended = Math.round((demandContrib + timingContrib + buildContrib + viralContrib) * 10) / 10;

    const weightBreakdown: ThesisExplainRecord['weightBreakdown'] = {
      demand: { score: thesis.avgDemand, weight: weights.demand, contribution: Math.round(demandContrib * 10) / 10 },
      timing: { score: thesis.avgTiming, weight: weights.timing, contribution: Math.round(timingContrib * 10) / 10 },
      buildability: { score: thesis.avgBuildability, weight: weights.buildability, contribution: Math.round(buildContrib * 10) / 10 },
      virality: { score: thesis.avgVirality, weight: weights.virality, contribution: Math.round(viralContrib * 10) / 10 },
      dimensionLabels: labels,
      blended,
      weightsSource: source,
    };

    // -- Debate --
    let debate: ThesisExplainRecord['debate'] = null;
    if (deps.pool) {
      const debateRes = await deps.pool.query<{
        bull_case: string;
        bear_case: string;
        moderator_verdict: Record<string, unknown>;
        created_at: Date;
      }>(
        `SELECT bull_case, bear_case, moderator_verdict, created_at
         FROM thesis_debates
         WHERE thesis_key = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [key],
      );

      if (debateRes.rows.length > 0) {
        const row = debateRes.rows[0];
        const v = row.moderator_verdict as any;
        debate = {
          bullCase: row.bull_case,
          bearCase: row.bear_case,
          verdict: String(v?.verdict ?? 'unknown'),
          confidence: Number(v?.confidence ?? 0),
          bullStrength: Number(v?.bull_strength ?? 0),
          bearStrength: Number(v?.bear_strength ?? 0),
          missingEvidence: Array.isArray(v?.missing_evidence) ? v.missing_evidence : [],
          debatedAt: new Date(row.created_at).toISOString(),
        };
      }
    }

    // -- Bayesian trail --
    let bayesianTrail: ThesisExplainRecord['bayesianTrail'] = {
      prior: thesis.confidence,
      posterior: thesis.posteriorConfidence ?? thesis.confidence,
      updates: [],
    };

    if (deps.pool) {
      // Each debate creates a Bayesian update. Reconstruct the trail from debates ASC.
      const trailRes = await deps.pool.query<{
        moderator_verdict: Record<string, unknown>;
        created_at: Date;
        bull_provider: string;
      }>(
        `SELECT moderator_verdict, created_at, bull_provider
         FROM thesis_debates
         WHERE thesis_key = $1
         ORDER BY created_at ASC`,
        [key],
      );

      if (trailRes.rows.length > 0) {
        const updates = trailRes.rows.map((r) => {
          const v = r.moderator_verdict as any;
          const verdictStr = String(v?.verdict ?? 'unknown');
          // Reconstruct delta from verdict type using same LR logic as agent_runner
          const VERDICT_LR: Record<string, number> = {
            strong_opportunity: 2.5,
            needs_investigation: 1.3,
            contested: 0.8,
            likely_noise: 0.3,
          };
          const lr = VERDICT_LR[verdictStr] ?? 1.0;
          // Delta approximation: (lr - 1) * 10 matches the bayesian update scale
          const delta = Math.round((lr - 1) * 10 * 10) / 10;
          return {
            source: `debate:${verdictStr}`,
            delta,
            at: new Date(r.created_at).toISOString(),
          };
        });
        bayesianTrail = { ...bayesianTrail, updates };
      }

      // Read prior/posterior from DB if available
      const confRes = await deps.pool.query<{
        prior_confidence: number | null;
        posterior_confidence: number | null;
      }>(
        `SELECT prior_confidence, posterior_confidence
         FROM thesis_candidates
         WHERE canonical_key = $1`,
        [key],
      );
      if (confRes.rows.length > 0) {
        const cr = confRes.rows[0];
        if (cr.prior_confidence != null) bayesianTrail.prior = Number(cr.prior_confidence);
        if (cr.posterior_confidence != null) bayesianTrail.posterior = Number(cr.posterior_confidence);
      }
    }

    // -- Top evidence --
    const topEvidence: ThesisExplainRecord['topEvidence'] = (thesis.evidence ?? [])
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5)
      .map((e) => ({
        signalId: e.signal_id,
        text: e.snippet,
        source: e.source ?? 'unknown',
        score: e.weight,
      }));

    const result: ThesisExplainRecord = {
      weightBreakdown,
      debate,
      bayesianTrail,
      topEvidence,
    };

    return result;
  });
};
