import { describe, expect, it } from 'vitest';
import { refreshTrendWindows } from '../src/jobs/memory_windows';

describe('memory window refresh', () => {
  it('produces rolling trend windows from historical records', () => {
    const windows = refreshTrendWindows(
      [
        {
          signal_id: 's1',
          topic: 'compliance',
          source: 'hn',
          canonical_text: 'soc2 pain',
          observed_at: '2026-02-22T00:00:00.000Z',
          demand: 78,
          timing: 66,
          buildability: 59,
          virality: 0,
          blended: 69
        },
        {
          signal_id: 's2',
          topic: 'compliance',
          source: 'hn',
          canonical_text: 'audit pain',
          observed_at: '2026-01-29T00:00:00.000Z',
          demand: 67,
          timing: 58,
          buildability: 61,
          virality: 0,
          blended: 62
        }
      ],
      new Date('2026-02-24T00:00:00.000Z')
    );

    expect(windows.some((entry) => entry.window === '7d')).toBe(true);
    expect(windows.some((entry) => entry.window === '30d')).toBe(true);
    expect(windows.some((entry) => entry.window === '90d')).toBe(true);
  });
});
