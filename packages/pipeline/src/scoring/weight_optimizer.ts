export type WeightConfig = {
  demand: number;
  timing: number;
  buildability: number;
  virality: number;
};

export type ValidatedPrediction = {
  thesis_key: string;
  demand_score: number;
  timing_score: number;
  buildability_score: number;
  virality_score: number;
  velocity: number;
  outcome_validated: boolean;
};

const blendWithWeights = (p: ValidatedPrediction, w: WeightConfig): number =>
  w.demand * p.demand_score + w.timing * p.timing_score +
  w.buildability * p.buildability_score + w.virality * p.virality_score;

export const computePrecision = (
  predictions: ValidatedPrediction[],
  weights: WeightConfig,
  threshold: number = 50
): number => {
  const predicted = predictions.filter(p => blendWithWeights(p, weights) >= threshold);
  if (predicted.length === 0) return NaN;
  const correct = predicted.filter(p => p.outcome_validated).length;
  return correct / predicted.length;
};

const range = (start: number, end: number, step: number): number[] => {
  const result: number[] = [];
  for (let v = start; v <= end + step / 10; v += step) result.push(Math.round(v * 100) / 100);
  return result;
};

const MIN_WEIGHT = 0.05;

export const optimizeWeights = (
  predictions: ValidatedPrediction[],
  gridStep: number = 0.05
): { weights: WeightConfig; precision: number } => {
  let bestWeights: WeightConfig = { demand: 0.25, timing: 0.2, buildability: 0.2, virality: 0.35 };
  let bestPrecision = -1;

  for (const demand of range(MIN_WEIGHT, 0.5, gridStep)) {
    for (const timing of range(MIN_WEIGHT, 0.4, gridStep)) {
      for (const buildability of range(MIN_WEIGHT, 0.4, gridStep)) {
        const virality = Math.round((1 - demand - timing - buildability) * 100) / 100;
        if (virality < MIN_WEIGHT || virality > 0.5) continue;

        const weights: WeightConfig = { demand, timing, buildability, virality };
        const precision = computePrecision(predictions, weights);
        if (!Number.isNaN(precision) && precision > bestPrecision) {
          bestPrecision = precision;
          bestWeights = weights;
        }
      }
    }
  }

  return { weights: bestWeights, precision: Math.max(bestPrecision, 0) };
};
