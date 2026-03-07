import { describe, expect, it, vi } from 'vitest';
import { snapshotPredictions, type SnapshotDeps } from '../src/jobs/backtest_snapshot';

describe('snapshotPredictions', () => {
  it('creates prediction records for theses above threshold', async () => {
    const inserted: any[] = [];
    const mockPool = {
      query: vi.fn(async (_sql: string, params: any[]) => {
        inserted.push(params);
        return { rows: [], rowCount: 1 };
      }),
    };

    const mockThesisStore = {
      list: vi.fn(async () => [
        { canonicalKey: 'test:a', confidence: 60, avgDemand: 70, avgTiming: 50, avgBuildability: 40, avgVirality: 80, velocity: 2.0, evidence: [] },
        { canonicalKey: 'test:b', confidence: 30, avgDemand: 20, avgTiming: 20, avgBuildability: 20, avgVirality: 20, velocity: null, evidence: [] },
      ]),
    };

    const result = await snapshotPredictions({
      pool: mockPool as any,
      thesisStore: mockThesisStore as any,
      confidenceThreshold: 50,
    });

    expect(result.snapshotted).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0][0]).toBe('test:a');
  });

  it('returns 0 when no theses qualify', async () => {
    const mockPool = { query: vi.fn() };
    const mockThesisStore = {
      list: vi.fn(async () => [
        { canonicalKey: 'test:low', confidence: 20, avgDemand: 10, avgTiming: 10, avgBuildability: 10, avgVirality: 10, velocity: null, evidence: [] },
      ]),
    };

    const result = await snapshotPredictions({
      pool: mockPool as any,
      thesisStore: mockThesisStore as any,
      confidenceThreshold: 50,
    });

    expect(result.snapshotted).toBe(0);
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
