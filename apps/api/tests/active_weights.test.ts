import { describe, expect, it } from 'vitest';
import { getActiveWeights, PROFILE_DEFAULT_WEIGHTS } from '../src/runtime/active_weights';

const mockPool = (rows: Record<string, unknown>[] = []) =>
  ({
    query: async () => ({ rows }),
  }) as any;

const errorPool = () =>
  ({
    query: async () => {
      throw new Error('connection refused');
    },
  }) as any;

describe('getActiveWeights', () => {
  it('returns default consumer weights when DB is empty', async () => {
    const result = await getActiveWeights(mockPool([]), 'consumer');
    expect(result).toEqual({
      profileId: 'consumer',
      demand: 0.25,
      timing: 0.20,
      buildability: 0.20,
      virality: 0.35,
      source: 'default',
    });
  });

  it('returns default b2b weights when DB is empty', async () => {
    const result = await getActiveWeights(mockPool([]), 'b2b');
    expect(result).toEqual({
      profileId: 'b2b',
      demand: 0.30,
      timing: 0.25,
      buildability: 0.25,
      virality: 0.20,
      source: 'default',
    });
  });

  it('returns optimized weights when DB has a row', async () => {
    const row = {
      demand_weight: 0.30,
      timing_weight: 0.25,
      buildability_weight: 0.15,
      virality_weight: 0.30,
    };
    const result = await getActiveWeights(mockPool([row]), 'consumer');
    expect(result).toEqual({
      profileId: 'consumer',
      demand: 0.30,
      timing: 0.25,
      buildability: 0.15,
      virality: 0.30,
      source: 'optimized',
    });
  });

  it('falls back to defaults on DB error', async () => {
    const result = await getActiveWeights(errorPool(), 'consumer');
    expect(result.source).toBe('default');
    expect(result.demand).toBe(0.25);
  });

  it('falls back to consumer defaults for unknown profile', async () => {
    const result = await getActiveWeights(mockPool([]), 'unknown');
    expect(result.source).toBe('default');
    expect(result.demand).toBe(PROFILE_DEFAULT_WEIGHTS['consumer']!.demand);
  });
});
