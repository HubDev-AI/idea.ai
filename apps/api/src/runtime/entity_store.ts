import type { Pool } from 'pg';
import { toVectorLiteral } from './db_utils';

export type EntityType = 'pain_point' | 'technology' | 'market' | 'competitor' | 'trend';
export type RelationType = 'causes' | 'enables' | 'competes_with' | 'addresses' | 'depends_on' | 'part_of';

export type EntityInput = {
  entity_type: EntityType;
  name: string;
  description?: string;
  embedding?: number[];
};

export type RelationInput = {
  source_entity_id: number;
  target_entity_id: number;
  relation_type: RelationType;
  confidence?: number;
  evidence_signal_ids?: string[];
};

export type EntitySummary = {
  name: string;
  mention_count: number;
  description?: string;
};

export type EntityStore = {
  upsertEntity(input: EntityInput): Promise<number>;
  upsertRelation(input: RelationInput): Promise<void>;
  findUnaddressedPains(minMentions: number): Promise<EntitySummary[]>;
  findEmergingTech(minMentions: number): Promise<EntitySummary[]>;
  getGraphContext(entityNames: string[]): Promise<string>;
};

export const createEntityStore = (deps: { pool: Pool }): EntityStore => ({
  async upsertEntity(input) {
    const embVal = input.embedding ? toVectorLiteral(input.embedding) : null;
    const { rows } = await deps.pool.query<{ id: number }>(
      `INSERT INTO entities (entity_type, name, description, embedding)
       VALUES ($1, $2, $3, $4::vector)
       ON CONFLICT (entity_type, name) DO UPDATE SET
         mention_count = entities.mention_count + 1,
         last_seen_at = NOW(),
         description = COALESCE(EXCLUDED.description, entities.description)
       RETURNING id`,
      [input.entity_type, input.name, input.description ?? null, embVal]
    );
    return rows[0].id;
  },

  async upsertRelation(input) {
    await deps.pool.query(
      `INSERT INTO entity_relations (source_entity_id, target_entity_id, relation_type, confidence, evidence_signal_ids)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_entity_id, target_entity_id, relation_type) DO UPDATE SET
         confidence = GREATEST(entity_relations.confidence, EXCLUDED.confidence),
         evidence_signal_ids = array_cat(entity_relations.evidence_signal_ids, EXCLUDED.evidence_signal_ids)`,
      [
        input.source_entity_id,
        input.target_entity_id,
        input.relation_type,
        input.confidence ?? 0.5,
        input.evidence_signal_ids ?? [],
      ]
    );
  },

  async findUnaddressedPains(minMentions) {
    const { rows } = await deps.pool.query<EntitySummary>(
      `SELECT p.name, p.mention_count, p.description
       FROM entities p
       LEFT JOIN entity_relations r ON r.source_entity_id = p.id AND r.relation_type = 'addresses'
       LEFT JOIN entities c ON c.id = r.target_entity_id AND c.entity_type = 'competitor'
       WHERE p.entity_type = 'pain_point'
         AND p.mention_count >= $1
         AND c.id IS NULL
       ORDER BY p.mention_count DESC
       LIMIT 20`,
      [minMentions]
    );
    return rows;
  },

  async findEmergingTech(minMentions) {
    const { rows } = await deps.pool.query<EntitySummary>(
      `SELECT t.name, t.mention_count, t.description
       FROM entities t
       WHERE t.entity_type = 'technology'
         AND t.mention_count >= $1
         AND NOT EXISTS (
           SELECT 1 FROM entity_relations r2
           JOIN entities prod ON prod.id = r2.source_entity_id
           WHERE r2.target_entity_id = t.id
             AND r2.relation_type = 'depends_on'
             AND prod.entity_type = 'competitor'
         )
       ORDER BY t.mention_count DESC
       LIMIT 20`,
      [minMentions]
    );
    return rows;
  },

  async getGraphContext(entityNames) {
    if (entityNames.length === 0) return '';
    const placeholders = entityNames.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await deps.pool.query<{
      entity_type: EntityType;
      name: string;
      mention_count: number;
      relation_type: RelationType | null;
      related_name: string | null;
      related_type: EntityType | null;
    }>(
      `SELECT e.entity_type, e.name, e.mention_count,
              r.relation_type, e2.name AS related_name, e2.entity_type AS related_type
       FROM entities e
       LEFT JOIN entity_relations r ON r.source_entity_id = e.id
       LEFT JOIN entities e2 ON e2.id = r.target_entity_id
       WHERE e.name = ANY(ARRAY[${placeholders}])
       ORDER BY e.mention_count DESC`,
      entityNames
    );

    if (rows.length === 0) return '';

    const lines: string[] = ['Related entities:'];
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.entity_type}:${row.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        lines.push(`- ${row.entity_type}: "${row.name}" (${row.mention_count} mentions)`);
      }
      if (row.related_name && row.relation_type) {
        lines.push(`  → ${row.relation_type} ${row.related_type}: "${row.related_name}"`);
      }
    }
    return lines.join('\n');
  },
});
