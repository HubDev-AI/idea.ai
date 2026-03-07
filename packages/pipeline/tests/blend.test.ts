import { describe, expect, it } from 'vitest';
import { blendedScore, blendedScoreWithWeights } from '../src/scoring/blend';

describe('blendedScoreWithWeights', () => {
  it('applies custom weights', () => {
    const scores = { demand: 100, timing: 0, buildability: 0, virality: 0 };
    const weights = { demand: 1.0, timing: 0, buildability: 0, virality: 0 };
    expect(blendedScoreWithWeights(scores, weights)).toBe(100);
  });

  it('matches default blendedScore with default weights', () => {
    const scores = { demand: 80, timing: 60, buildability: 70, virality: 90 };
    const defaultWeights = { demand: 0.25, timing: 0.20, buildability: 0.20, virality: 0.35 };
    expect(blendedScoreWithWeights(scores, defaultWeights)).toBe(blendedScore(scores));
  });
});
