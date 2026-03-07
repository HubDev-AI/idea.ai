import { describe, expect, it } from 'vitest';
import { scoreSignal } from '../src/jobs/score';

describe('memory-aware scoring', () => {
  it('applies memory features when context is provided', () => {
    const base = scoreSignal({
      text: 'manual costly compliance process creates friction',
      judgeScores: [60, 70, 65]
    });

    const withMemory = scoreSignal({
      text: 'manual costly compliance process creates friction',
      judgeScores: [60, 70, 65],
      memoryContext: {
        similar: [
          {
            signal_id: 'h1',
            distance: 0.2,
            demand: 85,
            timing: 70,
            source: 'hn',
            observed_at: '2026-02-20T00:00:00.000Z'
          }
        ],
        windows: [
          {
            topic: 'compliance',
            source: 'hn',
            window: '7d',
            count_signals: 12,
            avg_demand: 75,
            avg_timing: 66
          },
          {
            topic: 'compliance',
            source: 'hn',
            window: '30d',
            count_signals: 16,
            avg_demand: 63,
            avg_timing: 58
          },
          {
            topic: 'compliance',
            source: 'hn',
            window: '90d',
            count_signals: 28,
            avg_demand: 55,
            avg_timing: 51
          }
        ]
      }
    });

    expect(withMemory.demand).toBeGreaterThan(base.demand);
    expect(withMemory.timing).toBeGreaterThan(base.timing);
    expect(withMemory.memory.novelty).toBeGreaterThanOrEqual(0);
    expect(withMemory.memory.persistence).toBeGreaterThan(0);
  });

  it('uses custom weights when provided', () => {
    const weights = { demand: 0.5, timing: 0.1, buildability: 0.1, virality: 0.3 };
    const result = scoreSignal({
      text: 'manual costly compliance process creates friction',
      judgeScores: [60, 70, 65],
      weights,
    });
    const defaultResult = scoreSignal({
      text: 'manual costly compliance process creates friction',
      judgeScores: [60, 70, 65],
    });
    expect(result.blended).not.toBe(defaultResult.blended);
    expect(result.demand).toBe(defaultResult.demand);
  });
});
