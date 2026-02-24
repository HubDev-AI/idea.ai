import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

describe('feed API', () => {
  const servers: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
  });

  it('GET /v1/signals returns one-line feed records', async () => {
    const server = buildServer({
      listSignals: async () => [
        {
          idea: 'SOC2 prep copilot',
          score: 81,
          top_source: 'hacker_news',
          snippet: 'Founders repeating compliance pain',
          next_action: 'validate_demand',
          updated_at: '2026-02-24T00:00:00.000Z'
        }
      ],
      listConnectors: async () => []
    });

    servers.push(server);

    const response = await server.inject({ method: 'GET', url: '/v1/signals' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        idea: 'SOC2 prep copilot',
        score: 81,
        top_source: 'hacker_news',
        snippet: 'Founders repeating compliance pain',
        next_action: 'validate_demand',
        updated_at: '2026-02-24T00:00:00.000Z'
      }
    ]);
  });

  it('GET /v1/connectors returns status and last run', async () => {
    const server = buildServer({
      listSignals: async () => [],
      listConnectors: async () => [
        { name: 'hn', status: 'active', last_run: '2026-02-24T01:00:00.000Z' },
        { name: 'exa_byo', status: 'disabled', last_run: null }
      ]
    });

    servers.push(server);

    const response = await server.inject({ method: 'GET', url: '/v1/connectors' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { name: 'hn', status: 'active', last_run: '2026-02-24T01:00:00.000Z' },
      { name: 'exa_byo', status: 'disabled', last_run: null }
    ]);
  });
});
