import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

/**
 * Build a mock pool that responds to known queries.
 * Each call to pool.query checks the SQL text and returns the matching mock data.
 */
const buildMockPool = (opts?: {
  weightRows?: Record<string, unknown>[];
  historyRows?: Record<string, unknown>[];
  predictionRow?: { total: string; validated: string };
  experienceCount?: string;
}) => {
  const wRows = opts?.weightRows ?? [];
  const hRows = opts?.historyRows ?? [];
  const pRow = opts?.predictionRow ?? { total: '0', validated: '0' };
  const eCount = opts?.experienceCount ?? '0';

  return {
    query: async (sql: string) => {
      const s = typeof sql === 'string' ? sql : '';

      // getActiveWeights query
      if (s.includes('scoring_weight_history') && s.includes('LIMIT 1')) {
        return { rows: wRows };
      }
      // optimization history query
      if (s.includes('scoring_weight_history') && s.includes('LIMIT $2')) {
        return { rows: hRows };
      }
      // prediction track record
      if (s.includes('thesis_predictions')) {
        return { rows: [pRow] };
      }
      // experience library
      if (s.includes('experience_library')) {
        return { rows: [{ cnt: eCount }] };
      }
      return { rows: [] };
    },
  } as any;
};

describe('GET /v1/scoring-health', () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers.length = 0;
  });

  it('returns default weights and empty stats when DB is empty', async () => {
    const pool = buildMockPool();
    const app = await buildServer({ pool });
    servers.push(app);

    const res = await app.inject({ method: 'GET', url: '/v1/scoring-health' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.currentWeights.source).toBe('default');
    expect(body.currentWeights.profileId).toBe('consumer');
    expect(body.currentWeights.demand).toBe(0.25);
    expect(body.optimizationHistory).toEqual([]);
    expect(body.predictionTrackRecord.total).toBe(0);
    expect(body.predictionTrackRecord.accuracy).toBeNull();
    expect(body.experienceLibrarySize).toBe(0);
  });

  it('returns optimized weights when DB has weight history', async () => {
    const pool = buildMockPool({
      weightRows: [{
        demand_weight: 0.30,
        timing_weight: 0.25,
        buildability_weight: 0.15,
        virality_weight: 0.30,
      }],
      historyRows: [{
        computed_at: new Date('2026-03-07T10:00:00Z'),
        demand_weight: 0.30,
        timing_weight: 0.25,
        buildability_weight: 0.15,
        virality_weight: 0.30,
        precision_score: 0.85,
        sample_size: 50,
      }],
      predictionRow: { total: '20', validated: '15' },
      experienceCount: '42',
    });

    const app = await buildServer({ pool });
    servers.push(app);

    const res = await app.inject({ method: 'GET', url: '/v1/scoring-health' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.currentWeights.source).toBe('optimized');
    expect(body.currentWeights.demand).toBe(0.30);
    expect(body.optimizationHistory).toHaveLength(1);
    expect(body.optimizationHistory[0].precision).toBe(0.85);
    expect(body.optimizationHistory[0].sampleSize).toBe(50);
    expect(body.predictionTrackRecord.total).toBe(20);
    expect(body.predictionTrackRecord.validated).toBe(15);
    expect(body.predictionTrackRecord.accuracy).toBe(75);
    expect(body.experienceLibrarySize).toBe(42);
  });

  it('respects profile query parameter', async () => {
    const pool = buildMockPool();
    const app = await buildServer({ pool });
    servers.push(app);

    const res = await app.inject({ method: 'GET', url: '/v1/scoring-health?profile=b2b' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.currentWeights.profileId).toBe('b2b');
    expect(body.currentWeights.demand).toBe(0.30);
    expect(body.currentWeights.timing).toBe(0.25);
  });
});
