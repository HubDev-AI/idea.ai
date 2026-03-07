import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

const buildMockEntityStore = () => ({
  findUnaddressedPains: async () => [
    { name: 'slow onboarding', mention_count: 5, description: 'Users struggle with slow onboarding flows' },
  ],
  findEmergingTech: async () => [
    { name: 'webgpu', mention_count: 3, description: 'GPU-accelerated web rendering' },
  ],
  upsertEntity: async () => 1,
  upsertRelation: async () => {},
  getGraphContext: async () => '',
});

const buildMockPool = () => ({
  query: async (sql: string, params?: unknown[]) => {
    const s = typeof sql === 'string' ? sql : '';

    // Entity list query
    if (s.includes('FROM entities e') && s.includes('ORDER BY e.mention_count')) {
      return {
        rows: [
          {
            id: 1,
            entity_type: 'pain_point',
            name: 'slow onboarding',
            description: 'Users struggle with slow onboarding',
            mention_count: 5,
            first_seen_at: new Date('2026-03-01'),
            last_seen_at: new Date('2026-03-07'),
          },
          {
            id: 2,
            entity_type: 'technology',
            name: 'webgpu',
            description: null,
            mention_count: 3,
            first_seen_at: new Date('2026-03-02'),
            last_seen_at: new Date('2026-03-06'),
          },
        ],
      };
    }

    // Relations query
    if (s.includes('FROM entity_relations r')) {
      return {
        rows: [
          {
            source_entity_id: 2,
            relation_type: 'enables',
            target_name: 'slow onboarding',
            target_type: 'pain_point',
            confidence: 0.8,
          },
        ],
      };
    }

    // Total entity count
    if (s.includes('COUNT(*)') && s.includes('FROM entities')) {
      return { rows: [{ cnt: '10' }] };
    }

    // Total relations count
    if (s.includes('COUNT(*)') && s.includes('FROM entity_relations')) {
      return { rows: [{ cnt: '5' }] };
    }

    // scoring_weight_history for getActiveWeights
    if (s.includes('scoring_weight_history')) {
      return { rows: [] };
    }

    return { rows: [] };
  },
}) as any;

describe('Entities API', () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers.length = 0;
  });

  it('GET /v1/entities returns entity list with relations', async () => {
    const pool = buildMockPool();
    const entityStore = buildMockEntityStore();
    const app = await buildServer({ pool, entityStore });
    servers.push(app);

    const res = await app.inject({ method: 'GET', url: '/v1/entities' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);

    const first = body[0];
    expect(first.id).toBe(1);
    expect(first.entityType).toBe('pain_point');
    expect(first.name).toBe('slow onboarding');
    expect(first.mentionCount).toBe(5);
    expect(first.firstSeenAt).toMatch(/^\d{4}-\d{2}/);
    expect(first.lastSeenAt).toMatch(/^\d{4}-\d{2}/);
    expect(Array.isArray(first.relations)).toBe(true);

    const second = body[1];
    expect(second.relations).toHaveLength(1);
    expect(second.relations[0].relationType).toBe('enables');
    expect(second.relations[0].targetName).toBe('slow onboarding');
    expect(second.relations[0].confidence).toBe(0.8);
  });

  it('GET /v1/entities respects type filter', async () => {
    const queryCalls: string[] = [];
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        queryCalls.push(sql);
        if (sql.includes('FROM entities e') && sql.includes('ORDER BY')) {
          return { rows: [] };
        }
        if (sql.includes('scoring_weight_history')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    } as any;

    const entityStore = buildMockEntityStore();
    const app = await buildServer({ pool, entityStore });
    servers.push(app);

    await app.inject({ method: 'GET', url: '/v1/entities?type=technology' });
    const entityQuery = queryCalls.find(q => q.includes('FROM entities e') && q.includes('ORDER BY'));
    expect(entityQuery).toContain('entity_type');
  });

  it('GET /v1/entities/insights returns insights shape', async () => {
    const pool = buildMockPool();
    const entityStore = buildMockEntityStore();
    const app = await buildServer({ pool, entityStore });
    servers.push(app);

    const res = await app.inject({ method: 'GET', url: '/v1/entities/insights' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.totalEntities).toBe(10);
    expect(body.totalRelations).toBe(5);
    expect(Array.isArray(body.unaddressedPains)).toBe(true);
    expect(body.unaddressedPains[0].name).toBe('slow onboarding');
    expect(body.unaddressedPains[0].mentionCount).toBe(5);
    expect(Array.isArray(body.emergingTech)).toBe(true);
    expect(body.emergingTech[0].name).toBe('webgpu');
    expect(body.emergingTech[0].mentionCount).toBe(3);
  });

  it('GET /v1/entities limits to max 100', async () => {
    const queriedParams: unknown[][] = [];
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        if (params) queriedParams.push(params);
        if (sql.includes('FROM entities e') && sql.includes('ORDER BY')) {
          return { rows: [] };
        }
        if (sql.includes('scoring_weight_history')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    } as any;

    const entityStore = buildMockEntityStore();
    const app = await buildServer({ pool, entityStore });
    servers.push(app);

    await app.inject({ method: 'GET', url: '/v1/entities?limit=500' });
    // The first param to the entity query should be capped at 100
    const entityQueryParams = queriedParams.find(p => p[0] === 100);
    expect(entityQueryParams).toBeDefined();
  });
});
