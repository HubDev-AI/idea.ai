import { describe, expect, it } from 'vitest';
import { computeVelocity, velocityMultiplier } from '../src/scoring/velocity';

describe('computeVelocity', () => {
  it('returns 1 when 7d count equals avg weekly', () => {
    expect(computeVelocity(10, 10)).toBe(1);
  });

  it('returns > 1 when 7d count exceeds avg weekly', () => {
    expect(computeVelocity(30, 10)).toBe(3);
  });

  it('returns < 1 when 7d count is below avg weekly', () => {
    expect(computeVelocity(5, 10)).toBe(0.5);
  });

  it('returns 1 when avg weekly is 0', () => {
    expect(computeVelocity(5, 0)).toBe(1);
  });

  it('returns 1 when both are 0', () => {
    expect(computeVelocity(0, 0)).toBe(1);
  });
});

describe('velocityMultiplier', () => {
  it('returns 1.0 for velocity = 1 (stable)', () => {
    expect(velocityMultiplier(1)).toBe(1);
  });

  it('returns > 1.0 for growing topic', () => {
    expect(velocityMultiplier(2)).toBeGreaterThan(1);
  });

  it('returns < 1.0 for declining topic', () => {
    expect(velocityMultiplier(0.5)).toBeLessThan(1);
  });

  it('clamps to max 2.0', () => {
    expect(velocityMultiplier(100)).toBe(2);
  });

  it('clamps to min 0.5', () => {
    expect(velocityMultiplier(0)).toBe(0.5);
  });
});
