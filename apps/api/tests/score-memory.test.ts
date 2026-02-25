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
            pain: 85,
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
            avg_pain: 75,
            avg_timing: 66
          },
          {
            topic: 'compliance',
            source: 'hn',
            window: '30d',
            count_signals: 16,
            avg_pain: 63,
            avg_timing: 58
          },
          {
            topic: 'compliance',
            source: 'hn',
            window: '90d',
            count_signals: 28,
            avg_pain: 55,
            avg_timing: 51
          }
        ]
      }
    });

    expect(withMemory.pain).toBeGreaterThan(base.pain);
    expect(withMemory.timing).toBeGreaterThan(base.timing);
    expect(withMemory.memory.novelty).toBeGreaterThanOrEqual(0);
    expect(withMemory.memory.persistence).toBeGreaterThan(0);
  });
});
