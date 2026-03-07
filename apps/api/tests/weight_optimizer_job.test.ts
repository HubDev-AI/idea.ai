import { describe, expect, it, vi } from 'vitest';
import { runWeightOptimization } from '../src/jobs/weight_optimizer_job';

const mockPool = () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
});

describe('runWeightOptimization', () => {
  it('skips when not enough validated predictions', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({
      rows: Array.from({ length: 10 }, () => ({
        thesis_key: 'k', demand_score: 50, timing_score: 50,
        buildability_score: 50, virality_score: 50, velocity: 1,
        outcome_validated: true,
      })),
    });

    const result = await runWeightOptimization({
      pool: pool as any,
      minPredictions: 50,
      minImprovement: 0.05,
      gridStep: 0.1,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('predictions');
  });

  it('stores new weights when improvement exceeds threshold', async () => {
    const predictions = Array.from({ length: 60 }, (_, i) => ({
      thesis_key: `k${i}`,
      demand_score: i < 30 ? 90 : 10,
      timing_score: 50,
      buildability_score: 50,
      virality_score: i < 30 ? 20 : 80,
      velocity: 1,
      outcome_validated: i < 30,
    }));

    const pool = mockPool();
    pool.query.mockResolvedValueOnce({ rows: predictions });

    const result = await runWeightOptimization({
      pool: pool as any,
      minPredictions: 50,
      minImprovement: 0.01,
      gridStep: 0.1,
    });

    expect(result.skipped).toBe(false);
    const insertCall = pool.query.mock.calls.find(
      (c: any) => typeof c[0] === 'string' && c[0].includes('scoring_weight_history')
    );
    expect(insertCall).toBeDefined();
  });
});
