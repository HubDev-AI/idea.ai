import type { MemoryWindow, TrendWindowSnapshot } from '@idea/contracts/src/memory';

const clamp = (value: number): number => Math.min(100, Math.max(0, value));
const round2 = (value: number): number => Math.round(value * 100) / 100;

const trendByWindow = (windows: TrendWindowSnapshot[]): Partial<Record<MemoryWindow, TrendWindowSnapshot>> =>
  windows.reduce<Partial<Record<MemoryWindow, TrendWindowSnapshot>>>((acc, snapshot) => {
    acc[snapshot.window] = snapshot;
    return acc;
  }, {});

export const noveltyScoreFromDistances = (distances: number[]): number => {
  if (distances.length === 0) {
    return 100;
  }

  const avgDistance = distances.reduce((sum, distance) => sum + distance, 0) / distances.length;
  return round2(clamp(avgDistance * 100));
};

export const saturationScoreFromDistances = (distances: number[]): number => {
  if (distances.length === 0) {
    return 0;
  }

  const avgDistance = distances.reduce((sum, distance) => sum + distance, 0) / distances.length;
  return round2(clamp((1 - avgDistance) * 100));
};

export const persistenceScoreFromWindows = (windows: TrendWindowSnapshot[]): number => {
  const byWindow = trendByWindow(windows);

  const weightedPain = [
    { snapshot: byWindow['7d'], weight: 0.5 },
    { snapshot: byWindow['30d'], weight: 0.3 },
    { snapshot: byWindow['90d'], weight: 0.2 }
  ].reduce((sum, part) => {
    if (!part.snapshot) {
      return sum;
    }

    return sum + part.snapshot.avg_pain * part.weight;
  }, 0);

  return round2(clamp(weightedPain));
};

export const momentumScoreFromWindows = (windows: TrendWindowSnapshot[]): number => {
  const byWindow = trendByWindow(windows);
  const count7 = byWindow['7d']?.count_signals ?? 0;
  const count30Norm = (byWindow['30d']?.count_signals ?? 0) / 4.2857;
  const count90Norm = (byWindow['90d']?.count_signals ?? 0) / 12.857;
  const baseline = (count30Norm + count90Norm) / 2;

  if (count7 === 0 && baseline === 0) {
    return 0;
  }

  if (baseline === 0) {
    return 100;
  }

  const growth = (count7 - baseline) / Math.max(1, baseline);
  return round2(clamp(50 + growth * 50));
};

export const applyPainMemory = (painCurrent: number, persistenceScore: number): number =>
  round2(clamp(painCurrent * 0.7 + persistenceScore * 0.3));

export const applyTimingMemory = (
  timingCurrent: number,
  momentumScore: number,
  noveltyScore: number,
  saturationScore: number
): number => {
  const base = timingCurrent * 0.4 + momentumScore * 0.6;
  const noveltyAdjustment = noveltyScore * 0.1;
  const saturationPenalty = saturationScore * 0.1;

  return round2(clamp(base + noveltyAdjustment - saturationPenalty));
};
