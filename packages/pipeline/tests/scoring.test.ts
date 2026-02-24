import { describe, expect, it } from 'vitest';
import { scorePain } from '../src/scoring/pain';
import { scoreTiming } from '../src/scoring/timing';
import { scoreBuildability, medianOfThree } from '../src/scoring/buildability';
import { blendedScore } from '../src/scoring/blend';

describe('scoring pipeline', () => {
  it('keeps pain/timing/buildability in [0,100]', () => {
    const pain = scorePain('urgent churn risk and costly manual process');
    const timing = scoreTiming('new regulation deadline and market shift');
    const buildability = scoreBuildability([72, 68, 91]);

    expect(pain).toBeGreaterThanOrEqual(0);
    expect(pain).toBeLessThanOrEqual(100);
    expect(timing).toBeGreaterThanOrEqual(0);
    expect(timing).toBeLessThanOrEqual(100);
    expect(buildability).toBeGreaterThanOrEqual(0);
    expect(buildability).toBeLessThanOrEqual(100);
  });

  it('uses median score from 3 judges for buildability', () => {
    expect(medianOfThree([20, 80, 50])).toBe(50);
    expect(scoreBuildability([20, 80, 50])).toBe(50);
  });

  it('blends scores with 40/40/20 weights', () => {
    const score = blendedScore({ pain: 80, timing: 70, buildability: 60 });

    expect(score).toBe(72);
  });
});
