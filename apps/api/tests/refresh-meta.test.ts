import { describe, expect, it } from 'vitest';
import { createLiveReadModel } from '../src/runtime/live_read_model';

describe('refresh metadata', () => {
  it('returns null timestamps before the first refresh completes', async () => {
    const model = createLiveReadModel(60_000);

    expect(model.getRefreshMeta()).toEqual({
      last_hourly_run: null,
      last_daily_run: null,
      hourly_interval_ms: 60_000,
      daily_interval_ms: 24 * 60 * 60 * 1000,
      refreshing: null,
    });

    await model.close();
  });
});
