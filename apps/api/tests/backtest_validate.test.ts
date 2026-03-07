import { describe, expect, it, vi } from 'vitest';
import { validatePredictions, type ValidationDeps } from '../src/jobs/backtest_validate';

describe('validatePredictions', () => {
  it('validates predictions older than threshold days', async () => {
    const updates: any[] = [];
    const mockPool = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (sql.includes('SELECT')) {
          return {
            rows: [{
              id: 1,
              thesis_key: 'test:thesis',
              predicted_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
              confidence_at_prediction: 70,
            }],
          };
        }
        if (sql.includes('UPDATE')) {
          updates.push(params);
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const mockSignalSearch = vi.fn(async () => [
      { source: 'producthunt', canonical_text: 'matching product launch' },
    ]);

    const result = await validatePredictions({
      pool: mockPool as any,
      searchRecentSignals: mockSignalSearch,
      validateAfterDays: 30,
    });

    expect(result.checked).toBe(1);
    expect(result.validated).toBe(1);
    expect(updates.length).toBeGreaterThan(0);
  });

  it('marks unvalidated when no matching signals found', async () => {
    const mockPool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT')) {
          return {
            rows: [{
              id: 2,
              thesis_key: 'test:nope',
              predicted_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
              confidence_at_prediction: 55,
            }],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const result = await validatePredictions({
      pool: mockPool as any,
      searchRecentSignals: vi.fn(async () => []),
      validateAfterDays: 30,
    });

    expect(result.checked).toBe(1);
    expect(result.validated).toBe(0);
  });
});
