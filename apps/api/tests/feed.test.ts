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
          source_url: 'https://news.ycombinator.com/item?id=123',
          next_action: 'validate_demand',
          updated_at: '2026-02-24T00:00:00.000Z'
        }
      ],
      listConnectors: async () => []
    });

    servers.push(server);

    const response = await server.inject({ method: 'GET', url: '/v1/signals' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          idea: 'SOC2 prep copilot',
          score: 81,
          top_source: 'hacker_news',
          snippet: 'Founders repeating compliance pain',
          source_url: 'https://news.ycombinator.com/item?id=123',
          next_action: 'validate_demand',
          updated_at: '2026-02-24T00:00:00.000Z'
        }
      ],
      page: 1,
      page_size: 20,
      total_items: 1,
      total_pages: 1,
      has_next: false,
      has_prev: false
    });
  });

  it('GET /v1/signals applies pagination params', async () => {
    const server = buildServer({
      listSignals: async () =>
        Array.from({ length: 5 }).map((_, index) => ({
          idea: `idea-${index + 1}`,
          score: 60 + index,
          top_source: 'hacker_news',
          snippet: `snippet-${index + 1}`,
          source_url: null,
          next_action: 'validate_demand',
          updated_at: '2026-02-24T00:00:00.000Z'
        })),
      listConnectors: async () => []
    });

    servers.push(server);

    const response = await server.inject({ method: 'GET', url: '/v1/signals?page=2&page_size=2' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          idea: 'idea-3',
          score: 62,
          top_source: 'hacker_news',
          snippet: 'snippet-3',
          source_url: null,
          next_action: 'validate_demand',
          updated_at: '2026-02-24T00:00:00.000Z'
        },
        {
          idea: 'idea-4',
          score: 63,
          top_source: 'hacker_news',
          snippet: 'snippet-4',
          source_url: null,
          next_action: 'validate_demand',
          updated_at: '2026-02-24T00:00:00.000Z'
        }
      ],
      page: 2,
      page_size: 2,
      total_items: 5,
      total_pages: 3,
      has_next: true,
      has_prev: true
    });
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

  it('GET /v1/signals sanitizes malformed unicode for JSON safety', async () => {
    const server = buildServer({
      listSignals: async () => [
        {
          idea: 'broken-\ud83d',
          score: 81,
          top_source: 'hacker_news',
          snippet: 'snippet-\udc00',
          source_url: 'https://example.com/\ud83d',
          next_action: 'validate_demand',
          updated_at: '2026-02-24T00:00:00.000Z'
        }
      ],
      listConnectors: async () => []
    });

    servers.push(server);

    const response = await server.inject({ method: 'GET', url: '/v1/signals' });
    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.items[0].idea).toBe('broken-\uFFFD');
    expect(payload.items[0].snippet).toBe('snippet-\uFFFD');
    expect(payload.items[0].source_url).toBe('https://example.com/\uFFFD');
  });

  it('adds CORS headers and handles OPTIONS preflight', async () => {
    const server = buildServer({
      listSignals: async () => [],
      listConnectors: async () => []
    });

    servers.push(server);

    const preflight = await server.inject({
      method: 'OPTIONS',
      url: '/v1/signals',
      headers: {
        origin: 'http://localhost:5173'
      }
    });

    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(preflight.headers['access-control-allow-methods']).toBe('GET,POST,OPTIONS');

    const response = await server.inject({
      method: 'GET',
      url: '/v1/signals',
      headers: {
        origin: 'http://localhost:5173'
      }
    });

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('GET /v1/logs returns filtered execution logs', async () => {
    const server = buildServer({
      listSignals: async () => [],
      listConnectors: async () => [],
      listLogs: async (query) => {
        expect(query.limit).toBe(50);
        expect(query.level).toBe('error');
        expect(query.run_id).toBe('run-123');
        expect(query.scope).toBe('session');

        return [
          {
            ts: '2026-02-25T00:00:00.000Z',
            level: 'error',
            run_id: 'run-123',
            component: 'ai_judges',
            message: 'ai judge call failed for provider',
            context: {
              provider: 'claude'
            }
          }
        ];
      }
    });

    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/logs?limit=50&level=error&run_id=run-123'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        ts: '2026-02-25T00:00:00.000Z',
        level: 'error',
        run_id: 'run-123',
        component: 'ai_judges',
        message: 'ai judge call failed for provider',
        context: {
          provider: 'claude'
        }
      }
    ]);
  });

  it('GET /v1/ai-health returns provider execution health snapshot', async () => {
    const server = buildServer({
      listSignals: async () => [],
      listConnectors: async () => [],
      getAiHealth: async () => ({
        run_id: 'read_model-run-1',
        refreshed_at: '2026-02-26T00:00:00.000Z',
        provider_setting: 'both',
        judge_mode: 'single',
        fallback_enabled: true,
        retry_budget: 1,
        post_scrape_enabled: true,
        post_scrape_max_signals: 6,
        judge_max_signals: 2,
        providers: [
          {
            provider: 'claude',
            enabled: true,
            status: 'degraded',
            attempted: 3,
            succeeded: 2,
            failed: 1,
            retries: 1,
            last_error: 'claude timed out'
          },
          {
            provider: 'codex',
            enabled: true,
            status: 'healthy',
            attempted: 2,
            succeeded: 2,
            failed: 0,
            retries: 0,
            last_error: null
          }
        ]
      })
    });

    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/ai-health'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      run_id: 'read_model-run-1',
      refreshed_at: '2026-02-26T00:00:00.000Z',
      provider_setting: 'both',
      judge_mode: 'single',
      fallback_enabled: true,
      retry_budget: 1,
      post_scrape_enabled: true,
      post_scrape_max_signals: 6,
      judge_max_signals: 2,
      providers: [
        {
          provider: 'claude',
          enabled: true,
          status: 'degraded',
          attempted: 3,
          succeeded: 2,
          failed: 1,
          retries: 1,
          last_error: 'claude timed out'
        },
        {
          provider: 'codex',
          enabled: true,
          status: 'healthy',
          attempted: 2,
          succeeded: 2,
          failed: 0,
          retries: 0,
          last_error: null
        }
      ]
    });
  });
});
