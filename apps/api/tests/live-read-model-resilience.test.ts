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

  it('concurrent startRefresh calls only trigger one underlying refresh', async () => {
    let refreshCallCount = 0;

    vi.doMock('../src/jobs/ingest_open', () => ({
      runOpenConnectorIngestionDetailed: vi.fn(async (cadence: 'hourly' | 'daily') => {
        if (cadence === 'daily') {
          return { events: [], statuses: [] };
        }

        refreshCallCount += 1;

        return {
          events: [],
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

    const { createLiveReadModel } = await import('../src/runtime/live_read_model');
    const readModel = createLiveReadModel(0);

    // Fire two concurrent startRefresh calls without awaiting between them
    const [snap1, snap2] = await Promise.all([
      readModel.startRefresh(),
      readModel.startRefresh(),
    ]);

    expect(snap1).toBe(snap2);
    expect(refreshCallCount).toBe(1);
  });

  it('allows hourly refresh to run while a daily refresh is still in flight', async () => {
    let releaseDaily: (() => void) | null = null;
    let markDailyStarted: (() => void) | null = null;
    const dailyStarted = new Promise<void>((resolve) => {
      markDailyStarted = resolve;
    });
    let markHourlyStarted: (() => void) | null = null;
    const hourlyStarted = new Promise<void>((resolve) => {
      markHourlyStarted = resolve;
    });
    let hourlyCalls = 0;

    vi.doMock('../src/jobs/ingest_open', () => ({
      runOpenConnectorIngestionDetailed: vi.fn(async (cadence: 'hourly' | 'daily') => {
        if (cadence === 'daily') {
          markDailyStarted?.();
          await new Promise<void>((resolve) => {
            releaseDaily = resolve;
          });
          return {
            events: [],
            statuses: [
              { name: 'producthunt', cadence: 'daily', status: 'active' }
            ]
          };
        }

        hourlyCalls += 1;
        markHourlyStarted?.();
        return {
          events: [],
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

    const { createLiveReadModel } = await import('../src/runtime/live_read_model');
    const readModel = createLiveReadModel(60_000);

    const dailyPromise = readModel.startRefresh('daily');
    await dailyStarted;

    expect(readModel.getRefreshMeta().refreshing).toEqual({
      hourly: false,
      daily: true,
    });

    const hourlyPromise = readModel.startRefresh('hourly');
    await hourlyStarted;

    expect(hourlyCalls).toBe(1);
    expect(readModel.getRefreshMeta().refreshing).toEqual({
      hourly: true,
      daily: true,
    });

    (releaseDaily as unknown as () => void)();

    await Promise.all([dailyPromise, hourlyPromise]);

    expect(readModel.getRefreshMeta().refreshing).toEqual({
      hourly: false,
      daily: false,
    });
  });

  it('preserves daily connector error state across a later hourly-only refresh', async () => {
    let dailyCalls = 0;

    vi.doMock('../src/jobs/ingest_open', () => ({
      runOpenConnectorIngestionDetailed: vi.fn(async (cadence: 'hourly' | 'daily') => {
        if (cadence === 'daily') {
          dailyCalls += 1;
          return {
            events: [],
            statuses: dailyCalls === 1
              ? [{ name: 'producthunt', cadence: 'daily', status: 'error', last_error: 'api outage' }]
              : []
          };
        }

        return {
          events: [],
          statuses: [
            { name: 'hn', cadence: 'hourly', status: 'active' },
            { name: 'github_issues', cadence: 'hourly', status: 'active' }
          ]
        };
      })
    }));

    vi.doMock('../src/jobs/ingest_byo', () => ({
      runByoConnectorIngestion: vi.fn(async () => ({
        connectors: {
          exa: { status: 'skipped', reason: 'missing_credentials', events: [], telemetry: { connector: 'exa_byo', skipped: true, reason: 'missing_credentials', budget_usd: 0 } },
          perigon: { status: 'skipped', reason: 'missing_credentials', events: [], telemetry: { connector: 'perigon_byo', skipped: true, reason: 'missing_credentials', budget_usd: 0 } },
          twitter: { status: 'skipped', reason: 'missing_credentials', events: [], telemetry: { connector: 'twitter_byo', skipped: true, reason: 'missing_credentials', budget_usd: 0 } }
        }
      }))
    }));

    const { createLiveReadModel } = await import('../src/runtime/live_read_model');
    const readModel = createLiveReadModel(0);

    const first = await readModel.listConnectors();
    const second = await readModel.listConnectors();

    expect(first.find((connector) => connector.name === 'producthunt')?.status).toBe('error');
    expect(second.find((connector) => connector.name === 'producthunt')?.status).toBe('error');
  });

  it('hydrates persisted connector states on startup before the first refresh', async () => {
    const now = Date.now();
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
        lastHourlyRunAt: now,
        lastDailyRunAt: now,
        refreshedAt: now,
      })),
      listConnectorStates: vi.fn(async () => ([
        {
          connector_name: 'producthunt',
          status: 'error',
          last_run_at: '2026-03-11T08:00:00.000Z',
          last_error: 'api outage',
          cadence: 'daily',
        }
      ])),
      saveRefreshState: vi.fn(async () => {}),
      ping: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };

    const { createLiveReadModel } = await import('../src/runtime/live_read_model');
    const readModel = createLiveReadModel(3_600_000, { persistentStore: mockStore as any });

    const connectors = await readModel.listConnectors();
    const productHunt = connectors.find((connector) => connector.name === 'producthunt');

    expect(productHunt).toMatchObject({
      name: 'producthunt',
      status: 'error',
      last_run: '2026-03-11T08:00:00.000Z',
      cadence: 'daily',
    });
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
