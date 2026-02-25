import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('execution logging', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('writes a persistent execution log file when connector fetch fails', async () => {
    vi.doMock('@idea/connectors/src/exa_byo', () => ({
      runExaByoConnector: vi.fn(async () => {
        throw new Error('exa outage');
      })
    }));

    vi.doMock('@idea/connectors/src/perigon_byo', () => ({
      runPerigonByoConnector: vi.fn(async () => ({
        status: 'skipped',
        reason: 'missing_credentials',
        events: [],
        telemetry: {
          connector: 'perigon_byo',
          skipped: true,
          reason: 'missing_credentials',
          budget_usd: 5
        }
      }))
    }));

    const logDir = await mkdtemp(join(tmpdir(), 'idea-ai-logs-'));
    const { runByoConnectorIngestion } = await import('../src/jobs/ingest_byo');

    await runByoConnectorIngestion({ LOG_DIR: logDir, RUN_ID: 'test-run' });

    const files = await readdir(logDir);
    expect(files.length).toBeGreaterThan(0);

    const firstLogPath = join(logDir, files[0] as string);
    const payload = await readFile(firstLogPath, 'utf8');
    expect(payload).toContain('"run_id":"test-run"');
    expect(payload).toContain('"level":"error"');
    expect(payload).toContain('exa outage');
  });
});
