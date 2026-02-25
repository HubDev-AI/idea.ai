import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('BYO ingestion resilience', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('isolates connector failures and returns remaining connector data', async () => {
    vi.doMock('@idea/connectors/src/exa_byo', () => ({
      runExaByoConnector: vi.fn(async () => {
        throw new Error('exa outage');
      })
    }));

    vi.doMock('@idea/connectors/src/perigon_byo', () => ({
      runPerigonByoConnector: vi.fn(async () => ({
        status: 'active',
        events: [
          {
            source: 'perigon',
            source_item_id: 'p-1',
            source_timestamp: '2026-02-25T00:00:00.000Z',
            text: 'Perigon signal',
            url: 'https://perigon.example/signal'
          }
        ],
        telemetry: {
          connector: 'perigon_byo',
          skipped: false,
          budget_usd: 5
        }
      }))
    }));

    const { runByoConnectorIngestion } = await import('../src/jobs/ingest_byo');
    const result = await runByoConnectorIngestion({});

    expect(result.connectors.exa.status).toBe('error');
    expect(result.connectors.exa.events).toEqual([]);
    expect(result.connectors.perigon.status).toBe('active');
    expect(result.connectors.perigon.events).toHaveLength(1);
  });
});
