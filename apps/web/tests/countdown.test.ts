import { describe, expect, it } from 'vitest';

/** Duplicated from Sidebar for testing — kept in sync manually */
const formatCountdown = (ms: number): string => {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const computeCountdown = (lastRunIso: string, now: number): string => {
  const nextRefreshAt = new Date(lastRunIso).getTime() + REFRESH_INTERVAL_MS;
  const remaining = nextRefreshAt - now;
  if (remaining <= 0) return 'now';
  return formatCountdown(remaining);
};

describe('formatCountdown', () => {
  it('returns 0:00 for zero or negative', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-1000)).toBe('0:00');
  });

  it('formats seconds with zero padding', () => {
    expect(formatCountdown(5000)).toBe('0:05');
    expect(formatCountdown(9999)).toBe('0:10');
  });

  it('formats minutes and seconds', () => {
    expect(formatCountdown(60_000)).toBe('1:00');
    expect(formatCountdown(90_000)).toBe('1:30');
    expect(formatCountdown(299_000)).toBe('4:59');
    expect(formatCountdown(300_000)).toBe('5:00');
  });
});

describe('computeCountdown', () => {
  const lastRun = '2026-03-01T10:00:00.000Z';
  const lastRunMs = new Date(lastRun).getTime();

  it('returns full countdown right after refresh', () => {
    const result = computeCountdown(lastRun, lastRunMs + 1000);
    expect(result).toBe('4:59');
  });

  it('returns partial countdown mid-interval', () => {
    const result = computeCountdown(lastRun, lastRunMs + 3 * 60_000);
    expect(result).toBe('2:00');
  });

  it('returns "now" when interval has elapsed', () => {
    expect(computeCountdown(lastRun, lastRunMs + REFRESH_INTERVAL_MS)).toBe('now');
    expect(computeCountdown(lastRun, lastRunMs + REFRESH_INTERVAL_MS + 5000)).toBe('now');
  });

  it('handles fractional seconds by rounding up', () => {
    const result = computeCountdown(lastRun, lastRunMs + 299_500);
    expect(result).toBe('0:01');
  });
});
