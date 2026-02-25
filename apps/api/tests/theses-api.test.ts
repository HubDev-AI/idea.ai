import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';
import { InMemoryThesisStore } from '../src/runtime/thesis_store';

describe('GET /v1/theses', () => {
  const servers: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
  });

  it('returns empty array when no theses exist', async () => {
    const store = new InMemoryThesisStore();
    const app = buildServer({ thesisStore: store });
    servers.push(app);

    const response = await app.inject({ method: 'GET', url: '/v1/theses' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('returns theses sorted by confidence', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'low',
      title: 'Low',
      topic: 't',
      status: 'candidate',
      confidence: 40,
      scoreTotal: 40,
      problemStatement: 'p',
      targetBuyer: 'b',
      proposedSolution: 's',
      evidenceCount: 2,
      avgPain: 40,
      avgTiming: 30,
      avgBuildability: 50,
      latestObservedAt: '2026-02-25T10:00:00Z',
      evidence: []
    });
    await store.upsert({
      canonicalKey: 'high',
      title: 'High',
      topic: 't',
      status: 'promoted',
      confidence: 85,
      scoreTotal: 85,
      problemStatement: 'p',
      targetBuyer: 'b',
      proposedSolution: 's',
      evidenceCount: 5,
      avgPain: 80,
      avgTiming: 70,
      avgBuildability: 75,
      latestObservedAt: '2026-02-25T10:00:00Z',
      evidence: []
    });

    const app = buildServer({ thesisStore: store });
    servers.push(app);

    const response = await app.inject({ method: 'GET', url: '/v1/theses' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(2);
    expect(body[0].canonicalKey).toBe('high');
  });

  it('does not register thesis route when no store provided', async () => {
    const app = buildServer();
    servers.push(app);

    const response = await app.inject({ method: 'GET', url: '/v1/theses' });

    expect(response.statusCode).toBe(404);
  });

  it('GET /v1/theses/:key returns thesis by canonicalKey', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'test-key',
      title: 'Test Thesis',
      topic: 'testing',
      status: 'watching',
      confidence: 60,
      scoreTotal: 60,
      problemStatement: 'problem',
      targetBuyer: 'buyer',
      proposedSolution: 'solution',
      evidenceCount: 3,
      avgPain: 55,
      avgTiming: 50,
      avgBuildability: 45,
      latestObservedAt: '2026-02-25T10:00:00Z',
      evidence: [
        {
          signal_id: 'sig-1',
          relation: 'supporting',
          weight: 0.8,
          snippet: 'some evidence',
          observed_at: '2026-02-25T09:00:00Z'
        }
      ]
    });

    const app = buildServer({ thesisStore: store });
    servers.push(app);

    const response = await app.inject({ method: 'GET', url: '/v1/theses/test-key' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.canonicalKey).toBe('test-key');
    expect(body.evidence).toHaveLength(1);
  });

  it('GET /v1/theses/:key returns 404 for unknown key', async () => {
    const store = new InMemoryThesisStore();
    const app = buildServer({ thesisStore: store });
    servers.push(app);

    const response = await app.inject({ method: 'GET', url: '/v1/theses/nonexistent' });

    expect(response.statusCode).toBe(404);
  });
});
