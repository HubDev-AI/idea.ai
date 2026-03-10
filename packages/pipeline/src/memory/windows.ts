import type { MemoryWindow, SignalMemoryRecord, TrendWindowSnapshot } from '@idea/contracts/src/memory';
import { round2 } from '../utils';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS: Array<{ name: MemoryWindow; days: number }> = [
  { name: '7d', days: 7 },
  { name: '30d', days: 30 },
  { name: '90d', days: 90 }
];

export const buildTrendWindows = (
  history: SignalMemoryRecord[],
  now = new Date()
): TrendWindowSnapshot[] => {
  const nowMs = now.getTime();

  return WINDOWS.flatMap(({ name, days }) => {
    const cutoff = nowMs - days * DAY_MS;
    const scoped = history.filter((record) => new Date(record.observed_at).getTime() >= cutoff);

    const grouped = new Map<string, SignalMemoryRecord[]>();

    for (const record of scoped) {
      const key = `${record.topic}::${record.source}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.push(record);
      } else {
        grouped.set(key, [record]);
      }
    }

    return Array.from(grouped.entries()).map(([key, records]) => {
      const [topic = '', source = ''] = key.split('::');
      const count = records.length;
      const avgDemand = count === 0 ? 0 : records.reduce((sum, entry) => sum + entry.demand, 0) / count;
      const avgTiming =
        count === 0 ? 0 : records.reduce((sum, entry) => sum + entry.timing, 0) / count;

      return {
        topic,
        source,
        window: name,
        count_signals: count,
        avg_demand: round2(avgDemand),
        avg_timing: round2(avgTiming)
      };
    });
  });
};
