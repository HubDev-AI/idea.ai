import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { EntityInsights, EntityRecord } from '@idea/contracts/src/api';
import type { EntityStore } from '../runtime/entity_store';

export type EntitiesRouteDeps = {
  pool: Pool;
  entityStore: Pick<EntityStore, 'findUnaddressedPains' | 'findEmergingTech'>;
};

export const registerEntitiesRoute = (
  app: FastifyInstance,
  deps: EntitiesRouteDeps
): void => {
  // GET /v1/entities — paginated entity list
  app.get('/v1/entities', async (request, reply) => {
    const { type, limit: rawLimit } = request.query as {
      type?: string;
      limit?: string;
    };

    const limit = Math.min(100, Math.max(1, Number(rawLimit) || 50));

    const typeFilter = type && ['pain_point', 'technology', 'market', 'competitor', 'trend'].includes(type)
      ? type
      : null;

    const params: unknown[] = [limit];
    let whereClause = '';
    if (typeFilter) {
      whereClause = 'WHERE e.entity_type = $2';
      params.push(typeFilter);
    }

    const { rows: entityRows } = await deps.pool.query<{
      id: number;
      entity_type: string;
      name: string;
      description: string | null;
      mention_count: number;
      first_seen_at: Date;
      last_seen_at: Date;
    }>(
      `SELECT e.id, e.entity_type, e.name, e.description, e.mention_count,
              e.first_seen_at, e.last_seen_at
       FROM entities e
       ${whereClause}
       ORDER BY e.mention_count DESC
       LIMIT $1`,
      params
    );

    // Fetch relations for these entities
    const entityIds = entityRows.map(r => r.id);
    let relMap = new Map<number, EntityRecord['relations']>();

    if (entityIds.length > 0) {
      const placeholders = entityIds.map((_, i) => `$${i + 1}`).join(',');
      const { rows: relRows } = await deps.pool.query<{
        source_entity_id: number;
        relation_type: string;
        target_name: string;
        target_type: string;
        confidence: number;
      }>(
        `SELECT r.source_entity_id, r.relation_type,
                t.name AS target_name, t.entity_type AS target_type,
                r.confidence
         FROM entity_relations r
         JOIN entities t ON t.id = r.target_entity_id
         WHERE r.source_entity_id IN (${placeholders})
         ORDER BY r.confidence DESC`,
        entityIds
      );

      for (const rel of relRows) {
        const existing = relMap.get(rel.source_entity_id) ?? [];
        existing.push({
          relationType: rel.relation_type,
          targetName: rel.target_name,
          targetType: rel.target_type,
          confidence: Number(rel.confidence),
        });
        relMap.set(rel.source_entity_id, existing);
      }
    }

    const items: EntityRecord[] = entityRows.map(row => ({
      id: row.id,
      entityType: row.entity_type,
      name: row.name,
      description: row.description,
      mentionCount: Number(row.mention_count),
      firstSeenAt: new Date(row.first_seen_at).toISOString(),
      lastSeenAt: new Date(row.last_seen_at).toISOString(),
      relations: relMap.get(row.id) ?? [],
    }));

    return reply.send(items);
  });

  // GET /v1/entities/insights — unaddressed pains, emerging tech, totals
  app.get('/v1/entities/insights', async (_request, reply) => {
    const [pains, tech] = await Promise.all([
      deps.entityStore.findUnaddressedPains(2),
      deps.entityStore.findEmergingTech(2),
    ]);

    let totalEntities = 0;
    let totalRelations = 0;
    try {
      const entityCountRes = await deps.pool.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM entities`
      );
      totalEntities = parseInt(entityCountRes.rows[0]?.cnt ?? '0', 10);

      const relCountRes = await deps.pool.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM entity_relations`
      );
      totalRelations = parseInt(relCountRes.rows[0]?.cnt ?? '0', 10);
    } catch {
      // Tables may not exist yet
    }

    const result: EntityInsights = {
      unaddressedPains: pains.map(p => ({
        name: p.name,
        mentionCount: Number(p.mention_count),
        description: p.description ?? null,
      })),
      emergingTech: tech.map(t => ({
        name: t.name,
        mentionCount: Number(t.mention_count),
        description: t.description ?? null,
      })),
      totalEntities,
      totalRelations,
    };

    return reply.send(result);
  });
};
