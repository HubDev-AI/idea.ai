import { describe, expect, it } from 'vitest';
import { buildTrendWindows } from '../src/memory/windows';

describe('trend windows', () => {
  it('builds 7d/30d/90d snapshots per topic and source', () => {
    const snapshots = buildTrendWindows(
      [
        {
          signal_id: 's1',
          topic: 'compliance',
          source: 'hn',
          canonical_text: 'soc2 pain',
          observed_at: '2026-02-23T00:00:00.000Z',
          pain: 80,
          timing: 60,
          buildability: 50,
          blended: 66
        },
        {
          signal_id: 's2',
          topic: 'compliance',
          source: 'hn',
          canonical_text: 'audit pain',
          observed_at: '2026-02-10T00:00:00.000Z',
          pain: 70,
          timing: 55,
          buildability: 60,
          blended: 62
        }
      ],
      new Date('2026-02-24T00:00:00.000Z')
    );

    const sevenDay = snapshots.find((entry) => entry.window === '7d');
    const thirtyDay = snapshots.find((entry) => entry.window === '30d');
    const ninetyDay = snapshots.find((entry) => entry.window === '90d');

    expect(sevenDay?.count_signals).toBe(1);
    expect(thirtyDay?.count_signals).toBe(2);
    expect(ninetyDay?.count_signals).toBe(2);
  });
});
