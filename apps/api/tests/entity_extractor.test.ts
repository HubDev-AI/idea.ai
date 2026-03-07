import { describe, expect, it, vi } from 'vitest';
import { extractEntities, parseEntityResponse } from '../src/jobs/entity_extractor';

describe('parseEntityResponse', () => {
  it('parses valid entity extraction JSON', () => {
    const raw = JSON.stringify({
      entities: [
        { type: 'pain_point', name: 'slow deploys', description: 'Teams wait 30min for CI' },
        { type: 'technology', name: 'Docker', description: 'Container runtime' },
      ],
      relations: [
        { source: 'pain_point:slow deploys', target: 'technology:Docker', relation: 'addresses' },
      ],
    });
    const result = parseEntityResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.entities).toHaveLength(2);
    expect(result!.relations).toHaveLength(1);
  });

  it('returns null for garbage input', () => {
    expect(parseEntityResponse('not json')).toBeNull();
  });

  it('returns null for missing entities array', () => {
    expect(parseEntityResponse('{"relations": []}')).toBeNull();
  });

  it('filters out entities with invalid types', () => {
    const raw = JSON.stringify({
      entities: [
        { type: 'pain_point', name: 'valid' },
        { type: 'invalid_type', name: 'bad' },
      ],
      relations: [],
    });
    const result = parseEntityResponse(raw);
    expect(result!.entities).toHaveLength(1);
  });
});

describe('extractEntities', () => {
  it('calls router and upserts extracted entities', async () => {
    const upsertEntity = vi.fn().mockResolvedValue(1);
    const upsertRelation = vi.fn();
    const route = vi.fn().mockResolvedValue(JSON.stringify({
      entities: [{ type: 'pain_point', name: 'auth complexity' }],
      relations: [],
    }));

    await extractEntities({
      signalText: 'OAuth is too complex for indie devs',
      signalId: 'sig-1',
      route,
      entityStore: { upsertEntity, upsertRelation } as any,
    });

    expect(route).toHaveBeenCalledWith('entity_extraction', expect.any(String));
    expect(upsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({ entity_type: 'pain_point', name: 'auth complexity' })
    );
  });
});
