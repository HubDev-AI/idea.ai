import { describe, expect, it, vi } from 'vitest';
import { createEntityStore } from '../src/runtime/entity_store';

const mockPool = () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
});

describe('EntityStore', () => {
  it('upserts an entity (insert or increment count)', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const store = createEntityStore({ pool: pool as any });

    const id = await store.upsertEntity({
      entity_type: 'pain_point',
      name: 'multi-tenant DB migrations',
      description: 'Developers struggle with multi-tenant migration',
    });

    expect(id).toBe(1);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      expect.any(Array)
    );
  });

  it('upserts a relation', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const store = createEntityStore({ pool: pool as any });

    await store.upsertRelation({
      source_entity_id: 1,
      target_entity_id: 2,
      relation_type: 'addresses',
      confidence: 0.8,
      evidence_signal_ids: ['sig-123'],
    });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('entity_relations'),
      expect.any(Array)
    );
  });

  it('finds unaddressed pain points', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({
      rows: [{ name: 'agent memory', mention_count: 12 }],
    });
    const store = createEntityStore({ pool: pool as any });
    const pains = await store.findUnaddressedPains(5);
    expect(pains).toHaveLength(1);
    expect(pains[0].name).toBe('agent memory');
  });

  it('finds emerging technologies without products', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({
      rows: [{ name: 'WebGPU', mention_count: 15 }],
    });
    const store = createEntityStore({ pool: pool as any });
    const techs = await store.findEmergingTech(5);
    expect(techs).toHaveLength(1);
  });
});
