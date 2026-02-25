import { describe, expect, it } from 'vitest';
import {
  applyPainMemory,
  applyTimingMemory,
  momentumScoreFromWindows,
  noveltyScoreFromDistances,
  persistenceScoreFromWindows,
  saturationScoreFromDistances
} from '../src/memory/features';

describe('memory scoring features', () => {
  it('returns max novelty when no historical matches are present', () => {
    expect(noveltyScoreFromDistances([])).toBe(100);
    expect(saturationScoreFromDistances([])).toBe(0);
  });

  it('computes persistence with weighted windows', () => {
    const score = persistenceScoreFromWindows([
      { topic: 'compliance', source: 'hn', window: '7d', count_signals: 5, avg_pain: 70, avg_timing: 61 },
      { topic: 'compliance', source: 'hn', window: '30d', count_signals: 9, avg_pain: 60, avg_timing: 54 },
      { topic: 'compliance', source: 'hn', window: '90d', count_signals: 15, avg_pain: 50, avg_timing: 48 }
    ]);

    expect(score).toBe(63);
  });

  it('raises momentum when 7d activity accelerates against baseline', () => {
    const score = momentumScoreFromWindows([
      { topic: 'compliance', source: 'hn', window: '7d', count_signals: 14, avg_pain: 65, avg_timing: 58 },
      { topic: 'compliance', source: 'hn', window: '30d', count_signals: 20, avg_pain: 55, avg_timing: 52 },
      { topic: 'compliance', source: 'hn', window: '90d', count_signals: 48, avg_pain: 50, avg_timing: 49 }
    ]);

    expect(score).toBeGreaterThan(70);
  });

  it('applies memory-aware pain and timing blending', () => {
    expect(applyPainMemory(70, 50)).toBe(64);
    expect(applyTimingMemory(45, 80, 90, 20)).toBe(73);
  });
});
