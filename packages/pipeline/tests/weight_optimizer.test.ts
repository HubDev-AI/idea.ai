import { describe, expect, it } from 'vitest';
import {
  computePrecision,
  optimizeWeights,
  type ValidatedPrediction,
  type WeightConfig,
} from '../src/scoring/weight_optimizer';

const makePrediction = (
  overrides: Partial<ValidatedPrediction> = {}
): ValidatedPrediction => ({
  thesis_key: 'test:' + Math.random(),
  demand_score: 50,
  timing_score: 50,
  buildability_score: 50,
  virality_score: 50,
  velocity: 1,
  outcome_validated: false,
  ...overrides,
});

describe('computePrecision', () => {
  it('returns 1.0 when all high-scored predictions are validated', () => {
    const predictions: ValidatedPrediction[] = [
      makePrediction({ demand_score: 80, timing_score: 70, virality_score: 90, outcome_validated: true }),
      makePrediction({ demand_score: 20, timing_score: 30, virality_score: 10, outcome_validated: false }),
    ];
    const weights: WeightConfig = { demand: 0.25, timing: 0.2, buildability: 0.2, virality: 0.35 };
    const precision = computePrecision(predictions, weights, 50);
    expect(precision).toBe(1.0);
  });

  it('returns 0 when no high-scored predictions are validated', () => {
    const predictions: ValidatedPrediction[] = [
      makePrediction({ demand_score: 80, virality_score: 90, outcome_validated: false }),
    ];
    const weights: WeightConfig = { demand: 0.5, timing: 0.0, buildability: 0.0, virality: 0.5 };
    expect(computePrecision(predictions, weights, 50)).toBe(0);
  });

  it('returns NaN when no predictions above threshold', () => {
    const predictions: ValidatedPrediction[] = [
      makePrediction({ demand_score: 10, virality_score: 10, outcome_validated: true }),
    ];
    const weights: WeightConfig = { demand: 0.25, timing: 0.25, buildability: 0.25, virality: 0.25 };
    expect(Number.isNaN(computePrecision(predictions, weights, 80))).toBe(true);
  });
});

describe('optimizeWeights', () => {
  it('returns weights that maximize precision', () => {
    const predictions: ValidatedPrediction[] = [
      makePrediction({ demand_score: 90, virality_score: 20, outcome_validated: true }),
      makePrediction({ demand_score: 85, virality_score: 15, outcome_validated: true }),
      makePrediction({ demand_score: 10, virality_score: 95, outcome_validated: false }),
      makePrediction({ demand_score: 15, virality_score: 90, outcome_validated: false }),
    ];

    const result = optimizeWeights(predictions, 0.1);
    expect(result.weights.demand).toBeGreaterThan(result.weights.virality);
    expect(result.precision).toBeGreaterThan(0.5);
  });

  it('enforces minimum weight floor of 0.05', () => {
    const predictions: ValidatedPrediction[] = Array.from({ length: 10 }, (_, i) =>
      makePrediction({
        demand_score: i < 5 ? 90 : 10,
        timing_score: 50,
        buildability_score: 50,
        virality_score: 50,
        outcome_validated: i < 5,
      })
    );

    const result = optimizeWeights(predictions, 0.05);
    expect(result.weights.demand).toBeGreaterThanOrEqual(0.05);
    expect(result.weights.timing).toBeGreaterThanOrEqual(0.05);
    expect(result.weights.buildability).toBeGreaterThanOrEqual(0.05);
    expect(result.weights.virality).toBeGreaterThanOrEqual(0.05);
  });
});
