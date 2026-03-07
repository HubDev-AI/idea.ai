import type { EntityStore, EntityType, RelationType } from '../runtime/entity_store';

const VALID_ENTITY_TYPES = new Set<string>(['pain_point', 'technology', 'market', 'competitor', 'trend']);
const VALID_RELATION_TYPES = new Set<string>(['causes', 'enables', 'competes_with', 'addresses', 'depends_on', 'part_of']);

type RawEntity = { type: string; name: string; description?: string };
type RawRelation = { source: string; target: string; relation: string };
type ParsedResponse = { entities: RawEntity[]; relations: RawRelation[] };

export const ENTITY_EXTRACTION_PROMPT = `Extract entities from this signal. Return ONLY valid JSON:
{
  "entities": [
    {"type": "pain_point|technology|market|competitor|trend", "name": "...", "description": "..."}
  ],
  "relations": [
    {"source": "type:name", "target": "type:name", "relation": "causes|enables|competes_with|addresses|depends_on|part_of"}
  ]
}

Signal: `;

export const parseEntityResponse = (raw: string): ParsedResponse | null => {
  try {
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.entities)) return null;

    const entities = parsed.entities.filter(
      (e: any) => VALID_ENTITY_TYPES.has(e.type) && typeof e.name === 'string' && e.name.length > 0
    );
    const relations = Array.isArray(parsed.relations)
      ? parsed.relations.filter(
          (r: any) => typeof r.source === 'string' && typeof r.target === 'string' && VALID_RELATION_TYPES.has(r.relation)
        )
      : [];

    return { entities, relations };
  } catch {
    return null;
  }
};

export type EntityExtractionInput = {
  signalText: string;
  signalId: string;
  route: (task: string, prompt: string) => Promise<string>;
  entityStore: Pick<EntityStore, 'upsertEntity' | 'upsertRelation'>;
};

export const extractEntities = async (input: EntityExtractionInput): Promise<number> => {
  const raw = await input.route('entity_extraction', ENTITY_EXTRACTION_PROMPT + input.signalText.slice(0, 500));
  const parsed = parseEntityResponse(raw);
  if (!parsed) return 0;

  const entityIdMap = new Map<string, number>();

  for (const entity of parsed.entities) {
    const id = await input.entityStore.upsertEntity({
      entity_type: entity.type as EntityType,
      name: entity.name.toLowerCase().trim(),
      description: entity.description,
    });
    entityIdMap.set(`${entity.type}:${entity.name.toLowerCase().trim()}`, id);
  }

  for (const rel of parsed.relations) {
    const normalizeKey = (key: string) => {
      const [type, ...rest] = key.split(':');
      return `${type}:${rest.join(':').toLowerCase().trim()}`;
    };
    const sourceId = entityIdMap.get(normalizeKey(rel.source));
    const targetId = entityIdMap.get(normalizeKey(rel.target));
    if (sourceId && targetId) {
      await input.entityStore.upsertRelation({
        source_entity_id: sourceId,
        target_entity_id: targetId,
        relation_type: rel.relation as RelationType,
        evidence_signal_ids: [input.signalId],
      });
    }
  }

  return parsed.entities.length;
};
