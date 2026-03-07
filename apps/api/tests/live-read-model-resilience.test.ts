import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('live read model resilience', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('marks BYO connector as error when ingestion reports connector failure', async () => {
    vi.doMock('../src/jobs/ingest_open', () => ({
      runOpenConnectorIngestionDetailed: vi.fn(async (cadence: 'hourly' | 'daily') => {
        if (cadence === 'hourly') {
          return {
            events: [],
            statuses: [
              { name: 'hn', cadence: 'hourly', status: 'active' },
              { name: 'github_issues', cadence: 'hourly', status: 'active' }
            ]
          };
        }

        return {
          events: [],
          statuses: []
        };
      })
    }));

    vi.doMock('../src/jobs/ingest_byo', () => ({
      runByoConnectorIngestion: vi.fn(async () => ({
        connectors: {
          exa: {
            status: 'error',
            events: [],
            error: 'exa outage',
            telemetry: {
              connector: 'exa_byo',
              skipped: false,
              budget_usd: 5
            }
          },
          perigon: {
            status: 'skipped',
            reason: 'missing_credentials',
            events: [],
            telemetry: {
              connector: 'perigon_byo',
              skipped: true,
              reason: 'missing_credentials',
              budget_usd: 5
            }
          },
          twitter: {
            status: 'skipped',
            reason: 'missing_credentials',
            events: [],
            telemetry: {
              connector: 'twitter_byo',
              skipped: true,
              reason: 'missing_credentials',
              budget_usd: 0
            }
          }
        }
      }))
    }));

    const { createLiveReadModel } = await import('../src/runtime/live_read_model');
    const readModel = createLiveReadModel(0);

    const connectors = await readModel.listConnectors();
    const exa = connectors.find((connector) => connector.name === 'exa_byo');
    const perigon = connectors.find((connector) => connector.name === 'perigon_byo');

    expect(exa?.status).toBe('error');
    expect(perigon?.status).toBe('disabled');
  });

  it('marks open connector as error when that source fails while others succeed', async () => {
    vi.doMock('../src/jobs/ingest_open', () => ({
      runOpenConnectorIngestionDetailed: vi.fn(async (cadence: 'hourly' | 'daily') => {
        if (cadence === 'daily') {
          return {
            events: [],
            statuses: [
              { name: 'greenhouse', cadence: 'daily', status: 'active' },
              { name: 'lever', cadence: 'daily', status: 'active' }
            ]
          };
        }

        return {
          events: [
            {
              source: 'github_issues',
              source_item_id: '99',
              source_timestamp: '2026-02-25T00:00:00.000Z',
              text: 'Founders repeatedly hit billing edge cases',
              url: 'https://github.com/example/repo/issues/99'
            }
          ],
          statuses: [
            { name: 'hn', cadence: 'hourly', status: 'error', last_error: 'hn outage' },
            { name: 'github_issues', cadence: 'hourly', status: 'active' }
          ]
        };
      })
    }));

    vi.doMock('../src/jobs/ingest_byo', () => ({
      runByoConnectorIngestion: vi.fn(async () => ({
        connectors: {
          exa: {
            status: 'skipped',
            reason: 'missing_credentials',
            events: [],
            telemetry: {
              connector: 'exa_byo',
              skipped: true,
              reason: 'missing_credentials',
              budget_usd: 5
            }
          },
          perigon: {
            status: 'skipped',
            reason: 'missing_credentials',
            events: [],
            telemetry: {
              connector: 'perigon_byo',
              skipped: true,
              reason: 'missing_credentials',
              budget_usd: 5
            }
          },
          twitter: {
            status: 'skipped',
            reason: 'missing_credentials',
            events: [],
            telemetry: {
              connector: 'twitter_byo',
              skipped: true,
              reason: 'missing_credentials',
              budget_usd: 0
            }
          }
        }
      }))
    }));

    const { createLiveReadModel } = await import('../src/runtime/live_read_model');
    const readModel = createLiveReadModel(0);

    const connectors = await readModel.listConnectors();
    const signals = await readModel.listSignals();
    const hn = connectors.find((connector) => connector.name === 'hn');
    const github = connectors.find((connector) => connector.name === 'github_issues');

    expect(signals.length).toBeGreaterThan(0);
    expect(hn?.status).toBe('error');
    expect(github?.status).toBe('active');
  });

  it('returns last successful snapshot when a later refresh fails', async () => {
    let hourlyCalls = 0;

    vi.doMock('../src/jobs/ingest_open', () => ({
      runOpenConnectorIngestionDetailed: vi.fn(async (cadence: 'hourly' | 'daily') => {
        if (cadence === 'daily') {
          return {
            events: [],
            statuses: []
          };
        }

        hourlyCalls += 1;

        if (hourlyCalls === 1) {
          return {
            events: [
              {
                source: 'hn',
                source_item_id: '42',
                source_timestamp: '2026-02-25T00:00:00.000Z',
                text: 'SOC2 compliance burden keeps growing in startup teams',
                url: 'https://example.com/hn/42'
              }
            ],
            statuses: [
              { name: 'hn', cadence: 'hourly', status: 'active' },
              { name: 'github_issues', cadence: 'hourly', status: 'active' }
            ]
          };
        }

        throw new Error('hn outage');
      })
    }));

    vi.doMock('../src/jobs/ingest_byo', () => ({
      runByoConnectorIngestion: vi.fn(async () => ({
        connectors: {
          exa: {
            status: 'skipped',
            reason: 'missing_credentials',
            events: [],
            telemetry: {
              connector: 'exa_byo',
              skipped: true,
              reason: 'missing_credentials',
              budget_usd: 5
            }
          },
          perigon: {
            status: 'skipped',
            reason: 'missing_credentials',
            events: [],
            telemetry: {
              connector: 'perigon_byo',
              skipped: true,
              reason: 'missing_credentials',
              budget_usd: 5
            }
          },
          twitter: {
            status: 'skipped',
            reason: 'missing_credentials',
            events: [],
            telemetry: {
              connector: 'twitter_byo',
              skipped: true,
              reason: 'missing_credentials',
              budget_usd: 0
            }
          }
        }
      }))
    }));

    const { createLiveReadModel } = await import('../src/runtime/live_read_model');
    const readModel = createLiveReadModel(0);

    const first = await readModel.listSignals();
    const second = await readModel.listSignals();

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });

  it('loads refresh state from database and skips daily connectors when recently run', async () => {
    const recentDailyRun = Date.now() - 60_000; // 1 minute ago

    const dailyIngestionFn = vi.fn(async () => ({
      events: [],
      statuses: []
    }));

    vi.doMock('../src/jobs/ingest_open', () => ({
      runOpenConnectorIngestionDetailed: vi.fn(async (cadence: 'hourly' | 'daily') => {
        if (cadence === 'daily') {
          return dailyIngestionFn();
        }

        return {
          events: [
            {
              source: 'hn',
              source_item_id: '99',
              source_timestamp: '2026-02-25T00:00:00.000Z',
              text: 'Fresh hourly signal after restart',
              url: 'https://example.com/hn/99'
            }
          ],
          statuses: [
            { name: 'hn', cadence: 'hourly', status: 'active' }
          ]
        };
      })
    }));

    vi.doMock('../src/jobs/ingest_byo', () => ({
      runByoConnectorIngestion: vi.fn(async () => ({
        connectors: {
          exa: { status: 'skipped', reason: 'missing_credentials', events: [], telemetry: { connector: 'exa_byo', skipped: true, reason: 'missing_credentials', budget_usd: 5 } },
          perigon: { status: 'skipped', reason: 'missing_credentials', events: [], telemetry: { connector: 'perigon_byo', skipped: true, reason: 'missing_credentials', budget_usd: 5 } },
          twitter: { status: 'skipped', reason: 'missing_credentials', events: [], telemetry: { connector: 'twitter_byo', skipped: true, reason: 'missing_credentials', budget_usd: 0 } }
        }
      }))
    }));

    const mockStore = {
      retriever: { findSimilar: vi.fn(async () => []), getTrendWindows: vi.fn(async () => []) },
      save: vi.fn(async () => {}),
      listAllSignals: vi.fn(async () => []),
      querySignals: vi.fn(async () => ({ items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 1, hasNext: false, hasPrev: false })),
      countSignalsBySource: vi.fn(async () => ({})),
      getEmbeddings: vi.fn(async () => new Map()),
      getEmbeddingStats: vi.fn(async () => ({ total: 0, withEmbedding: 0, fallbackModel: 'none' })),
      findConvergentSignals: vi.fn(async () => []),
      boostViralityScore: vi.fn(async () => {}),
      listSignalsWithoutEmbeddings: vi.fn(async () => []),
      saveEmbedding: vi.fn(async () => {}),
      loadRefreshState: vi.fn(async () => ({
        lastHourlyRunAt: recentDailyRun,
        lastDailyRunAt: recentDailyRun,
        refreshedAt: recentDailyRun,
      })),
      saveRefreshState: vi.fn(async () => {}),
      ping: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };

    const { createLiveReadModel } = await import('../src/runtime/live_read_model');
    const readModel = createLiveReadModel(0, { persistentStore: mockStore as any });

    await readModel.listSignals();

    // Daily ingestion should NOT have been called since lastDailyRunAt was only 1 minute ago
    expect(dailyIngestionFn).not.toHaveBeenCalled();
    // Refresh state should have been loaded from DB
    expect(mockStore.loadRefreshState).toHaveBeenCalled();
    // And saved after successful refresh
    expect(mockStore.saveRefreshState).toHaveBeenCalled();
  });
});
