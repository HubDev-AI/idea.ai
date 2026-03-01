import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('loads persisted snapshot on restart when fresh refresh fails', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'idea-ai-snapshot-'));
    const snapshotFile = join(tempDir, 'snapshot.json');
    const previousSnapshot = {
      refreshedAt: Date.now() - 60_000,
      signals: [
        {
          idea: 'Persisted opportunity',
          score: 77,
          top_source: 'github_issues',
          snippet: 'previously computed signal',
          source_url: 'https://github.com/example/repo/issues/1',
          next_action: 'validate_demand',
          updated_at: '2026-02-25T00:00:00.000Z'
        }
      ],
      connectors: [
        {
          name: 'github_issues',
          status: 'active',
          last_run: '2026-02-25T00:00:00.000Z'
        }
      ]
    };

    await writeFile(snapshotFile, JSON.stringify(previousSnapshot), 'utf8');
    const originalSnapshotFile = process.env.SNAPSHOT_FILE;
    process.env.SNAPSHOT_FILE = snapshotFile;

    vi.doMock('../src/jobs/ingest_open', () => ({
      runOpenConnectorIngestionDetailed: vi.fn(async () => {
        throw new Error('network down');
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

    try {
      const { createLiveReadModel } = await import('../src/runtime/live_read_model');
      const readModel = createLiveReadModel(0);

      const signals = await readModel.listSignals();
      expect(signals).toEqual(previousSnapshot.signals);
    } finally {
      process.env.SNAPSHOT_FILE = originalSnapshotFile;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
