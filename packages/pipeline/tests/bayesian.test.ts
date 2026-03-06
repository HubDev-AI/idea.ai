import { describe, expect, it } from 'vitest';
import {
  bayesianUpdate,
  computeDecay,
  DEFAULT_BAYESIAN_CONFIG
} from '../src/scoring/bayesian';

describe('bayesianUpdate', () => {
  const config = DEFAULT_BAYESIAN_CONFIG;

  it('increases posterior for confirming multi-source signal', () => {
    const result = bayesianUpdate(20, { type: 'multi_source_convergence', confirming: true, sourceCount: 3 }, config);
    expect(result).toBeGreaterThan(20);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('decreases posterior for contradicting signal', () => {
    const result = bayesianUpdate(60, { type: 'single_high_quality', confirming: false, sourceCount: 1 }, config);
    expect(result).toBeLessThan(60);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('clamps posterior to [0, 100]', () => {
    const high = bayesianUpdate(99, { type: 'multi_source_convergence', confirming: true, sourceCount: 5 }, config);
    expect(high).toBeLessThanOrEqual(100);
    const low = bayesianUpdate(1, { type: 'multi_source_convergence', confirming: false, sourceCount: 5 }, config);
    expect(low).toBeGreaterThanOrEqual(0);
  });

  it('weak signal barely moves confidence', () => {
    const result = bayesianUpdate(50, { type: 'weak_noisy', confirming: true, sourceCount: 1 }, config);
    expect(result).toBeGreaterThan(50);
    expect(result).toBeLessThan(56);
  });
});

describe('computeDecay', () => {
  it('returns same confidence if within grace period', () => {
    expect(computeDecay(80, 10, DEFAULT_BAYESIAN_CONFIG)).toBe(80);
  });

  it('decays confidence after grace period', () => {
    const decayed = computeDecay(80, 20, DEFAULT_BAYESIAN_CONFIG);
    expect(decayed).toBeLessThan(80);
    expect(decayed).toBeGreaterThan(0);
  });

  it('never decays below floor', () => {
    const decayed = computeDecay(80, 100, DEFAULT_BAYESIAN_CONFIG);
    expect(decayed).toBeGreaterThanOrEqual(DEFAULT_BAYESIAN_CONFIG.floorConfidence);
  });
});
