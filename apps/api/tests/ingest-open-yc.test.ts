import { describe, expect, it } from 'vitest';
import { runOpenConnectorIngestionDetailed } from '../src/jobs/ingest_open';

describe('open ingestion with YC connector', () => {
  it('ingests yc_companies on daily cadence and marks connector active', async () => {
    const result = await runOpenConnectorIngestionDetailed('daily', {
      enabledConnectors: ['yc_companies'],
      loaders: {
        yc_companies: async () => [
          {
            source: 'yc_companies',
            source_item_id: 'yc:acme',
            source_timestamp: '2026-02-25T00:00:00.000Z',
            text: 'Acme\nAI workflow automation for support teams',
            url: 'https://www.ycombinator.com/companies/acme'
          }
        ]
      }
    });

    expect(result.events).toHaveLength(1);
    expect(result.statuses).toEqual([
      {
        name: 'yc_companies',
        cadence: 'daily',
        status: 'active'
      }
    ]);
  });
});
