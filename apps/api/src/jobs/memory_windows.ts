import type { SignalMemoryRecord, TrendWindowSnapshot } from '@idea/contracts/src/memory';
import { buildTrendWindows } from '@idea/pipeline/src/memory/windows';

export const refreshTrendWindows = (
  history: SignalMemoryRecord[],
  now = new Date()
): TrendWindowSnapshot[] => buildTrendWindows(history, now);
