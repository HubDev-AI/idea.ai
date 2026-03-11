import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
        { signal_id: 's1', relation: 'supporting', weight: 0.9, snippet: 'Strong demand', observed_at: '2026-03-06T10:00:00Z', source: 'reddit' },
        { signal_id: 's2', relation: 'adjacent', weight: 0.5, snippet: 'Moderate', observed_at: '2026-03-06T11:00:00Z', source: 'github_issues' },
        { signal_id: 's3', relation: 'contradicting', weight: 0.3, snippet: 'Weak', observed_at: '2026-03-06T12:00:00Z', source: 'producthunt' },
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
    expect(body.weightBreakdown.dimensionLabels).toEqual({
      demand: 'Demand',
      timing: 'Timing',
      buildability: 'Buildability',
      virality: 'Virality',
    });
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
    expect(body.topEvidence[0].source).toBe('reddit');
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

  it('loads optimized weights asynchronously through server wiring', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'optimized-weights',
      title: 'Optimized Weights',
      topic: 'testing',
      status: 'watching',
      confidence: 50,
      scoreTotal: 50,
      problemStatement: 'p',
      targetBuyer: 'b',
      proposedSolution: 's',
      evidenceCount: 0,
      avgDemand: 80,
      avgTiming: 60,
      avgBuildability: 40,
      avgVirality: 20,
      latestObservedAt: '2026-03-07T10:00:00Z',
      evidence: [],
      profileId: 'consumer',
    });

    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM scoring_weight_history')) {
          return {
            rows: [{
              demand_weight: 0.4,
              timing_weight: 0.3,
              buildability_weight: 0.2,
              virality_weight: 0.1,
            }]
          };
        }
        return { rows: [] };
      }),
    } as any;

    const app = await buildServer({ thesisStore: store, pool });
    servers.push(app);

    const res = await app.inject({ method: 'GET', url: '/v1/theses/optimized-weights/explain' });
    const body = res.json();

    expect(body.weightBreakdown.weightsSource).toBe('optimized');
    expect(body.weightBreakdown.demand.weight).toBe(0.4);
    expect(body.weightBreakdown.blended).toBe(60);
  });

  it('returns profile-aware dimension labels for b2b theses', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'b2b-explain',
      title: 'B2B Explain Test',
      topic: 'ops',
      status: 'watching',
      confidence: 70,
      scoreTotal: 70,
      problemStatement: 'Need explainability',
      targetBuyer: 'Ops leaders',
      proposedSolution: 'Workflow automation',
      evidenceCount: 1,
      avgDemand: 75,
      avgTiming: 65,
      avgBuildability: 55,
      avgVirality: 45,
      latestObservedAt: '2026-03-07T10:00:00Z',
      evidence: [
        { signal_id: 'sig-b2b', relation: 'supporting', weight: 0.8, snippet: 'Teams complain about manual ops', observed_at: '2026-03-06T10:00:00Z', source: 'reddit' },
      ],
      profileId: 'b2b',
    });

    const app = await buildServer({ thesisStore: store });
    servers.push(app);

    const res = await app.inject({ method: 'GET', url: '/v1/theses/b2b-explain/explain' });
    const body = res.json();

    expect(body.weightBreakdown.dimensionLabels).toEqual({
      demand: 'Enterprise Pain',
      timing: 'Market Size',
      buildability: 'Moat Potential',
      virality: 'Feasibility',
    });
    expect(body.topEvidence[0].source).toBe('reddit');
  });
});
