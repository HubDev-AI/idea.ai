import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

describe('connectors cadence', () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
  });

  it('GET /v1/connectors includes cadence on each record', async () => {
    const server = await buildServer({
      listConnectors: async () => [
        { name: 'hn', status: 'active', last_run: '2026-03-01T10:00:00Z', cadence: 'hourly' },
        { name: 'reddit', status: 'active', last_run: '2026-03-01T10:00:00Z', cadence: 'daily' },
        { name: 'exa_byo', status: 'disabled', last_run: null, cadence: 'daily' }
      ]
    });
    servers.push(server);

    const res = await server.inject({ method: 'GET', url: '/v1/connectors' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(3);
    expect(body[0]).toMatchObject({ name: 'hn', cadence: 'hourly' });
    expect(body[1]).toMatchObject({ name: 'reddit', cadence: 'daily' });
    expect(body[2]).toMatchObject({ name: 'exa_byo', cadence: 'daily' });
  });

  it('cadence can be null for unknown connectors', async () => {
    const server = await buildServer({
      listConnectors: async () => [
        { name: 'custom', status: 'active', last_run: '2026-03-01T10:00:00Z', cadence: null }
      ]
    });
    servers.push(server);

    const res = await server.inject({ method: 'GET', url: '/v1/connectors' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0]).toMatchObject({ name: 'custom', cadence: null });
  });
});
