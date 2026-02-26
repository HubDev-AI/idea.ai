import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

describe('CORS', () => {
  it('allows whitelisted origin', async () => {
    const app = await buildServer({ corsOrigins: ['http://localhost:5173'] });
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' }
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('rejects non-whitelisted origin', async () => {
    const app = await buildServer({ corsOrigins: ['http://localhost:5173'] });
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://evil.com' }
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows all origins when corsOrigins is empty', async () => {
    const app = await buildServer({ corsOrigins: [] });
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://anything.com' }
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://anything.com');
  });
});

describe('API key auth', () => {
  it('returns 401 when API_KEY is set and request has no key', async () => {
    const app = await buildServer({ apiKey: 'test-secret' });
    const res = await app.inject({ method: 'GET', url: '/v1/connectors' });
    expect(res.statusCode).toBe(401);
  });

  it('passes when correct key is provided', async () => {
    const app = await buildServer({ apiKey: 'test-secret' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/connectors',
      headers: { 'x-api-key': 'test-secret' }
    });
    expect(res.statusCode).toBe(200);
  });

  it('skips auth for /health', async () => {
    const app = await buildServer({ apiKey: 'test-secret' });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('skips auth when API_KEY is not set', async () => {
    const app = await buildServer({});
    const res = await app.inject({ method: 'GET', url: '/v1/connectors' });
    expect(res.statusCode).toBe(200);
  });
});

describe('schema validation', () => {
  it('rejects non-numeric page param', async () => {
    const app = await buildServer({});
    const res = await app.inject({ method: 'GET', url: '/v1/signals?page=abc' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects non-numeric page_size param', async () => {
    const app = await buildServer({});
    const res = await app.inject({ method: 'GET', url: '/v1/signals?page_size=xyz' });
    expect(res.statusCode).toBe(400);
  });

  it('accepts valid numeric page param', async () => {
    const app = await buildServer({});
    const res = await app.inject({ method: 'GET', url: '/v1/signals?page=1' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects non-numeric limit on logs', async () => {
    const app = await buildServer({});
    const res = await app.inject({ method: 'GET', url: '/v1/logs?limit=abc' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid level on logs', async () => {
    const app = await buildServer({});
    const res = await app.inject({ method: 'GET', url: '/v1/logs?level=critical' });
    expect(res.statusCode).toBe(400);
  });

  it('accepts valid logs query', async () => {
    const app = await buildServer({});
    const res = await app.inject({ method: 'GET', url: '/v1/logs?limit=50&level=info' });
    expect(res.statusCode).toBe(200);
  });
});

describe('rate limiting', () => {
  it('returns rate limit headers', async () => {
    const app = await buildServer({ rateLimitMax: 5 });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
  });
});
