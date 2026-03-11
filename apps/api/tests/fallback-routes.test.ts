import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryThesisStore } from '../src/runtime/thesis_store';
import { buildServer } from '../src/server';

describe('in-memory fallback routes', () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
  });

  it('applies source, window, and sort semantics for GET /v1/signals without a signalStore', async () => {
    const recent = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const stale = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const server = await buildServer({
      listSignals: async () => [
        {
          idea: 'Recent low-score reddit idea',
          score: 41,
          top_source: 'reddit',
          snippet: 'low score recent reddit snippet',
          source_url: null,
          next_action: 'validate_demand',
          updated_at: recent,
          demand: 50,
        },
        {
          idea: 'Recent high-score reddit idea',
          score: 88,
          top_source: 'reddit',
          snippet: 'high score recent reddit snippet',
          source_url: null,
          next_action: 'validate_demand',
          updated_at: recent,
          demand: 90,
        },
        {
          idea: 'Stale hacker news idea',
          score: 99,
          top_source: 'hn',
          snippet: 'stale hn snippet',
          source_url: null,
          next_action: 'validate_demand',
          updated_at: stale,
          demand: 95,
        }
      ],
      listConnectors: async () => []
    });
    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/signals?source=reddit&window=1d&sort=score'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        expect.objectContaining({ idea: 'Recent high-score reddit idea', top_source: 'reddit' }),
        expect.objectContaining({ idea: 'Recent low-score reddit idea', top_source: 'reddit' }),
      ],
      page: 1,
      page_size: 20,
      total_items: 2,
      total_pages: 1,
      has_next: false,
      has_prev: false,
    });
  });

  it('returns paginated profile- and label-filtered theses without a postgres thesis store', async () => {
    const store = new InMemoryThesisStore();

    await store.upsert({
      canonicalKey: 'consumer-top',
      title: 'Consumer Top',
      topic: 'consumer',
      status: 'promoted',
      confidence: 91,
      scoreTotal: 91,
      problemStatement: 'consumer problem',
      targetBuyer: 'consumer',
      proposedSolution: 'consumer solution',
      evidenceCount: 4,
      avgDemand: 80,
      avgTiming: 70,
      avgBuildability: 60,
      avgVirality: 50,
      latestObservedAt: '2026-03-11T08:00:00.000Z',
      evidence: [],
      profileId: 'consumer',
      label: 'favourite',
    });
    await store.upsert({
      canonicalKey: 'b2b-top',
      title: 'B2B Top',
      topic: 'b2b',
      status: 'promoted',
      confidence: 89,
      scoreTotal: 89,
      problemStatement: 'b2b problem',
      targetBuyer: 'ops',
      proposedSolution: 'b2b solution',
      evidenceCount: 6,
      avgDemand: 86,
      avgTiming: 78,
      avgBuildability: 58,
      avgVirality: 20,
      latestObservedAt: '2026-03-11T08:05:00.000Z',
      evidence: [],
      profileId: 'b2b',
      label: 'favourite',
    });
    await store.upsert({
      canonicalKey: 'b2b-later',
      title: 'B2B Later',
      topic: 'b2b',
      status: 'watching',
      confidence: 70,
      scoreTotal: 70,
      problemStatement: 'later b2b problem',
      targetBuyer: 'finance',
      proposedSolution: 'later b2b solution',
      evidenceCount: 3,
      avgDemand: 65,
      avgTiming: 55,
      avgBuildability: 60,
      avgVirality: 10,
      latestObservedAt: '2026-03-11T08:10:00.000Z',
      evidence: [],
      profileId: 'b2b',
      label: 'later',
    });

    const app = await buildServer({ thesisStore: store });
    servers.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/theses?page=1&page_size=1&profile=b2b&label=favourite&sort=score'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        expect.objectContaining({
          canonicalKey: 'b2b-top',
          title: 'B2B Top',
          label: 'favourite',
          profileId: 'b2b',
        })
      ],
      page: 1,
      page_size: 1,
      total_items: 1,
      total_pages: 1,
      has_next: false,
      has_prev: false,
      stats: expect.any(Object),
    });
  });
});
