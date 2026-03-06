import type { Pool } from 'pg';
import type { ThesisStore } from '../runtime/thesis_store';

export type SnapshotDeps = {
  pool: Pool;
  thesisStore: ThesisStore;
  confidenceThreshold?: number;
};

export const snapshotPredictions = async (
  deps: SnapshotDeps
): Promise<{ snapshotted: number }> => {
  const threshold = deps.confidenceThreshold ?? 50;
  const theses = await deps.thesisStore.list();
  const qualified = theses.filter(t => t.confidence >= threshold);

  let snapshotted = 0;
  for (const thesis of qualified) {
    await deps.pool.query(
      `INSERT INTO thesis_predictions
        (thesis_key, predicted_at, confidence_at_prediction, demand_score, timing_score,
         buildability_score, virality_score, velocity, source_categories)
       VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (thesis_key, predicted_at) DO NOTHING`,
      [
        thesis.canonicalKey,
        thesis.confidence,
        thesis.avgDemand ?? null,
        thesis.avgTiming ?? null,
        thesis.avgBuildability ?? null,
        thesis.avgVirality ?? null,
        thesis.velocity ?? null,
        thesis.evidence?.length ?? 0,
      ]
    );
    snapshotted++;
  }

  return { snapshotted };
};
