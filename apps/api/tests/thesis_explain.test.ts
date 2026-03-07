import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryThesisStore } from '../src/runtime/thesis_store';
import { buildServer } from '../src/server';

describe('GET /v1/theses/:key/explain', () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers.length = 0;
  });

  it('returns 404 for unknown thesis', async () => {
    const store = new InMemoryThesisStore();
    const app = await buildServer({ thesisStore: store });
    servers.push(app);

    const res = await app.inject({ method: 'GET', url: '/v1/theses/nonexistent/explain' });
    expect(res.statusCode).toBe(404);
  });

  it('returns 200 with correct explain shape for known thesis', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'test-explain',
      title: 'Explain Test',
      topic: 'testing',
      status: 'watching',
      confidence: 72,
      scoreTotal: 72,
      problemStatement: 'Need explainability',
      targetBuyer: 'PMs',
      proposedSolution: 'Dashboard',
      evidenceCount: 3,
      avgDemand: 80,
      avgTiming: 60,
      avgBuildability: 70,
      avgVirality: 50,
      latestObservedAt: '2026-03-07T10:00:00Z',
      evidence: [
        { signal_id: 's1', relation: 'supporting', weight: 0.9, snippet: 'Strong demand', observed_at: '2026-03-06T10:00:00Z' },
        { signal_id: 's2', relation: 'adjacent', weight: 0.5, snippet: 'Moderate', observed_at: '2026-03-06T11:00:00Z' },
        { signal_id: 's3', relation: 'contradicting', weight: 0.3, snippet: 'Weak', observed_at: '2026-03-06T12:00:00Z' },
      ],
    });

    const app = await buildServer({ thesisStore: store });
    servers.push(app);

    const res = await app.inject({ method: 'GET', url: '/v1/theses/test-explain/explain' });
    expect(res.statusCode).toBe(200);

    const body = res.json();

    // Weight breakdown
    expect(body.weightBreakdown).toBeDefined();
    expect(body.weightBreakdown.demand).toHaveProperty('score');
    expect(body.weightBreakdown.demand).toHaveProperty('weight');
    expect(body.weightBreakdown.demand).toHaveProperty('contribution');
    expect(body.weightBreakdown.timing).toBeDefined();
    expect(body.weightBreakdown.buildability).toBeDefined();
    expect(body.weightBreakdown.virality).toBeDefined();
    expect(typeof body.weightBreakdown.blended).toBe('number');
    expect(body.weightBreakdown.weightsSource).toBe('default');

    // Verify blended = sum of contributions
    const sumContrib =
      body.weightBreakdown.demand.contribution +
      body.weightBreakdown.timing.contribution +
      body.weightBreakdown.buildability.contribution +
      body.weightBreakdown.virality.contribution;
    expect(body.weightBreakdown.blended).toBeCloseTo(sumContrib, 0);

    // Debate (null without pool)
    expect(body.debate).toBeNull();

    // Bayesian trail
    expect(body.bayesianTrail).toBeDefined();
    expect(typeof body.bayesianTrail.prior).toBe('number');
    expect(typeof body.bayesianTrail.posterior).toBe('number');
    expect(Array.isArray(body.bayesianTrail.updates)).toBe(true);

    // Top evidence (sorted by weight desc, max 5)
    expect(body.topEvidence).toHaveLength(3);
    expect(body.topEvidence[0].signalId).toBe('s1');
    expect(body.topEvidence[0].score).toBe(0.9);
  });

  it('returns correct consumer weight contributions', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'weights-test',
      title: 'Weights',
      topic: 'testing',
      status: 'watching',
      confidence: 50,
      scoreTotal: 50,
      problemStatement: 'p',
      targetBuyer: 'b',
      proposedSolution: 's',
      evidenceCount: 0,
      avgDemand: 100,
      avgTiming: 100,
      avgBuildability: 100,
      avgVirality: 100,
      latestObservedAt: '2026-03-07T10:00:00Z',
      evidence: [],
    });

    const app = await buildServer({ thesisStore: store });
    servers.push(app);

    const res = await app.inject({ method: 'GET', url: '/v1/theses/weights-test/explain' });
    const body = res.json();

    // Consumer default: demand=0.25, timing=0.20, buildability=0.20, virality=0.35
    expect(body.weightBreakdown.demand.weight).toBe(0.25);
    expect(body.weightBreakdown.timing.weight).toBe(0.2);
    expect(body.weightBreakdown.buildability.weight).toBe(0.2);
    expect(body.weightBreakdown.virality.weight).toBe(0.35);
    // All scores 100 => blended = 100
    expect(body.weightBreakdown.blended).toBe(100);
  });
});
