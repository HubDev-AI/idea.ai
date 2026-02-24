import { describe, expect, it } from 'vitest';
import { runExaByoConnector } from '../src/exa_byo';
import { runPerigonByoConnector } from '../src/perigon_byo';

describe('BYO connectors', () => {
  it('skips connector when credentials are missing', async () => {
    const exa = await runExaByoConnector({}, async () => []);
    const perigon = await runPerigonByoConnector({}, async () => []);

    expect(exa.status).toBe('skipped');
    expect(exa.reason).toBe('missing_credentials');
    expect(perigon.status).toBe('skipped');
    expect(perigon.reason).toBe('missing_credentials');
  });

  it('returns events when credentials are present', async () => {
    const exa = await runExaByoConnector(
      { EXA_API_KEY: 'exa-key', EXA_DAILY_BUDGET_USD: '5' },
      async () => [
        {
          source: 'exa',
          source_item_id: 'exa-1',
          source_timestamp: '2026-02-24T00:00:00.000Z',
          text: 'EXA event',
          url: 'https://exa.ai/example'
        }
      ]
    );

    const perigon = await runPerigonByoConnector(
      { PERIGON_API_KEY: 'perigon-key', PERIGON_DAILY_BUDGET_USD: '5' },
      async () => [
        {
          source: 'perigon',
          source_item_id: 'peri-1',
          source_timestamp: '2026-02-24T00:00:00.000Z',
          text: 'Perigon event',
          url: 'https://perigon.io/example'
        }
      ]
    );

    expect(exa.status).toBe('active');
    expect(exa.events).toHaveLength(1);
    expect(perigon.status).toBe('active');
    expect(perigon.events).toHaveLength(1);
  });
});
