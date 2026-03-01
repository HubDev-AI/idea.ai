import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

describe('GET /v1/infra/status', () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
  });

  it('returns structured health info', async () => {
    const app = await buildServer({
      infraStatusDeps: {
        checkPostgres: async () => true,
        checkOllama: async () => false,
        getEmbeddingStats: async () => ({ total: 100, withEmbedding: 80, fallbackModel: 'nomic-embed-text' })
      }
    });
    servers.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/infra/status'
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.postgres).toBe('ok');
    expect(body.ollama).toBe('error');
    expect(body.embeddings.total).toBe(100);
    expect(body.embeddings.withEmbedding).toBe(80);
    expect(body.embeddings.fallbackModel).toBe('nomic-embed-text');
  });

  it('handles dependency failures gracefully', async () => {
    const app = await buildServer({
      infraStatusDeps: {
        checkPostgres: async () => { throw new Error('connection refused'); },
        checkOllama: async () => { throw new Error('timeout'); },
        getEmbeddingStats: async () => { throw new Error('table missing'); }
      }
    });
    servers.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/infra/status'
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.postgres).toBe('error');
    expect(body.ollama).toBe('error');
    expect(body.embeddings.total).toBe(0);
  });
});
