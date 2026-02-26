import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

describe('CORS', () => {
  it('allows whitelisted origin', async () => {
    const app = buildServer({ corsOrigins: ['http://localhost:5173'] });
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' }
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('rejects non-whitelisted origin', async () => {
    const app = buildServer({ corsOrigins: ['http://localhost:5173'] });
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://evil.com' }
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows all origins when corsOrigins is empty', async () => {
    const app = buildServer({ corsOrigins: [] });
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://anything.com' }
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://anything.com');
  });
});
