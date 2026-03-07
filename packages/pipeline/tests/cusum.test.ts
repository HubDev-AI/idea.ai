import { describe, expect, it } from 'vitest';
import { detectChangePoints, type CusumConfig, DEFAULT_CUSUM_CONFIG } from '../src/scoring/cusum';

describe('detectChangePoints', () => {
  it('returns empty for flat signal', () => {
    const values = [10, 10, 10, 10, 10, 10, 10];
    expect(detectChangePoints(values)).toEqual([]);
  });

  it('detects upward change point', () => {
    const values = [10, 10, 10, 10, 50, 50, 50];
    const points = detectChangePoints(values);
    expect(points.length).toBeGreaterThanOrEqual(1);
    expect(points[0]).toBeGreaterThanOrEqual(3);
    expect(points[0]).toBeLessThanOrEqual(5);
  });

  it('detects downward change point', () => {
    const values = [50, 50, 50, 50, 10, 10, 10];
    const points = detectChangePoints(values);
    expect(points.length).toBeGreaterThanOrEqual(1);
  });

  it('respects custom threshold', () => {
    const values = [10, 10, 12, 10, 11, 10, 10];
    expect(detectChangePoints(values)).toEqual([]);
    const points = detectChangePoints(values, { threshold: 0.5, drift: 0.1 });
    expect(points.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty input', () => {
    expect(detectChangePoints([])).toEqual([]);
  });

  it('handles single value', () => {
    expect(detectChangePoints([42])).toEqual([]);
  });
});
