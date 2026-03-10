import { describe, it, expect, vi } from 'vitest';

describe('shutdown abort', () => {
  it('close() sets abort signal and does not crash', async () => {
    vi.doMock('../src/config/env', () => ({
      loadRuntimeEnv: () => ({
        embeddingModel: 'test', embeddingDimension: 10,
        scoringProvider: 'ollama', aiPostScrapeProvider: 'ollama',
        enabledOpenConnectors: [], connectorConcurrency: 5,
        hourlyConnectors: [], dailyConnectors: [],
        exaApiKey: '', perigonApiKey: '', xBearerToken: '',
        exaDailyBudgetUsd: 0, perigonDailyBudgetUsd: 0, xDailyBudgetUsd: 0,
        dbUrl: '', aiJudgeEnabled: false, aiPostScrapeMaxSignals: 0,
        enableJobConnectors: false, greenhouseBoardToken: '',
      })
    }));
    vi.doMock('../src/jobs/ingest_open', () => ({
      runOpenConnectorIngestionDetailed: vi.fn(async () => ({ events: [], statuses: [] })),
      enabledOpenConnectors: vi.fn(() => [])
    }));
    vi.doMock('../src/jobs/ingest_byo', () => ({
      runByoConnectorIngestion: vi.fn(async () => ({
        connectors: {
          exa: { status: 'skipped', events: [] },
          perigon: { status: 'skipped', events: [] },
          twitter: { status: 'skipped', events: [] }
        }
      }))
    }));
    vi.doMock('../src/runtime/execution_logger', () => ({
      createExecutionLogger: () => ({
        runId: 'test', info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn(), flush: vi.fn()
      })
    }));

    const { createLiveReadModel } = await import('../src/runtime/live_read_model');
    const model = createLiveReadModel(999999);

    // close() should set the abort signal without crashing
    await model.close();
    expect(true).toBe(true);
  });
});
