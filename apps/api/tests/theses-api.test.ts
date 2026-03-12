import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryThesisStore } from '../src/runtime/thesis_store';
import { buildServer } from '../src/server';

describe('GET /v1/theses', () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
  });

  it('returns empty array when no theses exist', async () => {
    const store = new InMemoryThesisStore();
    const app = await buildServer({ thesisStore: store });
    servers.push(app);

    const response = await app.inject({ method: 'GET', url: '/v1/theses' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [],
      page: 1,
      page_size: 10,
      total_items: 0,
      total_pages: 1,
      has_next: false,
      has_prev: false,
      stats: {
        total: 0,
        promoted: 0,
        watching: 0,
        totalEvidence: 0,
        totalSources: 0,
      }
    });
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
      avgDemand: 40,
      avgTiming: 30,
      avgBuildability: 50,
      avgVirality: 10,
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
      avgDemand: 80,
      avgTiming: 70,
      avgBuildability: 75,
      avgVirality: 40,
      latestObservedAt: '2026-02-25T10:00:00Z',
      evidence: []
    });

    const app = await buildServer({ thesisStore: store });
    servers.push(app);

    const response = await app.inject({ method: 'GET', url: '/v1/theses' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0].canonicalKey).toBe('high');
    expect(body.total_items).toBe(2);
  });

  it('sorts newest by first seen in the in-memory fallback and exposes firstSeenAt', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'older-but-updated',
      title: 'Older but updated',
      topic: 't',
      status: 'watching',
      confidence: 55,
      scoreTotal: 55,
      problemStatement: 'p',
      targetBuyer: 'b',
      proposedSolution: 's',
      evidenceCount: 2,
      avgDemand: 55,
      avgTiming: 50,
      avgBuildability: 45,
      avgVirality: 20,
      latestObservedAt: '2026-02-25T11:30:00Z',
      firstObservedAt: '2026-02-20T08:00:00Z',
      evidence: []
    } as any);
    await store.upsert({
      canonicalKey: 'actually-newest',
      title: 'Actually newest',
      topic: 't',
      status: 'candidate',
      confidence: 50,
      scoreTotal: 50,
      problemStatement: 'p',
      targetBuyer: 'b',
      proposedSolution: 's',
      evidenceCount: 1,
      avgDemand: 50,
      avgTiming: 45,
      avgBuildability: 40,
      avgVirality: 15,
      latestObservedAt: '2026-02-24T09:00:00Z',
      firstObservedAt: '2026-02-24T08:00:00Z',
      evidence: []
    } as any);

    const app = await buildServer({ thesisStore: store });
    servers.push(app);

    const response = await app.inject({ method: 'GET', url: '/v1/theses?sort=newest' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0].canonicalKey).toBe('actually-newest');
    expect(body.items[0].firstSeenAt).toBe('2026-02-24T08:00:00.000Z');
    expect(body.items[1].firstSeenAt).toBe('2026-02-20T08:00:00.000Z');
  });

  it('does not register thesis route when no store provided', async () => {
    const app = await buildServer();
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
      avgDemand: 55,
      avgTiming: 50,
      avgBuildability: 45,
      avgVirality: 20,
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

    const app = await buildServer({ thesisStore: store });
    servers.push(app);

    const response = await app.inject({ method: 'GET', url: '/v1/theses/test-key' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.canonicalKey).toBe('test-key');
    expect(body.evidence).toHaveLength(1);
  });

  it('GET /v1/theses/:key returns 404 for unknown key', async () => {
    const store = new InMemoryThesisStore();
    const app = await buildServer({ thesisStore: store });
    servers.push(app);

    const response = await app.inject({ method: 'GET', url: '/v1/theses/nonexistent' });

    expect(response.statusCode).toBe(404);
  });

  it('PATCH /v1/theses/:key/label sets label', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'label-test',
      title: 'Label Test',
      topic: 't',
      status: 'candidate',
      confidence: 50,
      scoreTotal: 50,
      problemStatement: 'p',
      targetBuyer: 'b',
      proposedSolution: 's',
      evidenceCount: 1,
      avgDemand: 50,
      avgTiming: 50,
      avgBuildability: 50,
      avgVirality: 0,
      latestObservedAt: '2026-02-25T10:00:00Z',
      evidence: []
    });

    const app = await buildServer({ thesisStore: store });
    servers.push(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/theses/label-test/label',
      payload: { label: 'favourite' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().label).toBe('favourite');
  });

  it('PATCH /v1/theses/:key/label with null removes label', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'label-test2',
      title: 'Label Test 2',
      topic: 't',
      status: 'candidate',
      confidence: 50,
      scoreTotal: 50,
      problemStatement: 'p',
      targetBuyer: 'b',
      proposedSolution: 's',
      evidenceCount: 1,
      avgDemand: 50,
      avgTiming: 50,
      avgBuildability: 50,
      avgVirality: 0,
      latestObservedAt: '2026-02-25T10:00:00Z',
      evidence: []
    });

    const app = await buildServer({ thesisStore: store });
    servers.push(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/theses/label-test2/label',
      payload: { label: null }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().label).toBeNull();
  });

  it('PATCH /v1/theses/:key/label rejects invalid label', async () => {
    const store = new InMemoryThesisStore();
    const app = await buildServer({ thesisStore: store });
    servers.push(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/theses/any-key/label',
      payload: { label: 'invalid' }
    });

    expect(response.statusCode).toBe(400);
  });
});
