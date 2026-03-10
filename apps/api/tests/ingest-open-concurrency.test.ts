import { describe, it, expect } from 'vitest';
import { runOpenConnectorIngestionDetailed } from '../src/jobs/ingest_open';

describe('concurrent connector execution', () => {
  it('runs connectors concurrently up to the concurrency limit', async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const slowLoader = () => async () => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
      await new Promise((r) => setTimeout(r, 50));
      currentConcurrent--;
      return [];
    };

    await runOpenConnectorIngestionDetailed('hourly', {
      enabledConnectors: ['hn', 'github_issues', 'showhn'],
      loaders: {
        hn: slowLoader(),
        github_issues: slowLoader(),
        showhn: slowLoader(),
      },
      concurrency: 2,
    });

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(maxConcurrent).toBeGreaterThan(1);
  });
});
