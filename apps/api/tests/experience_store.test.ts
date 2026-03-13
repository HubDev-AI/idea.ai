import { describe, expect, it, vi } from 'vitest';
import { createExperienceStore } from '../src/runtime/experience_store';

const mockPool = () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
});

describe('ExperienceStore', () => {
  it('inserts a new experience entry', async () => {
    const pool = mockPool();
    const store = createExperienceStore({ pool: pool as any });

    await store.insert({
      thesis_key: 'consumer:test',
      signal_summary: 'HN post about X, Reddit thread about Y',
      reasoning_trajectory: 'High demand + no competitors = opportunity',
      thesis_output: 'Build an X for Y',
      confidence_at_creation: 65,
      outcome_validated: true,
      confidence_at_validation: 82,
    });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO experience_library'),
      expect.any(Array)
    );
  });

  it('retrieves top N validated experiences', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, thesis_key: 'k1', signal_summary: 's1', reasoning_trajectory: 'r1',
          thesis_output: 't1', outcome_validated: true, confidence_at_creation: 60,
          confidence_at_validation: 80 },
      ],
    });
    const store = createExperienceStore({ pool: pool as any });
    const results = await store.listValidated(5);
    expect(results).toHaveLength(1);
    expect(results[0]!.thesis_key).toBe('k1');
  });

  it('retrieves similar experiences by embedding', async () => {
    const pool = mockPool();
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1, thesis_key: 'k', signal_summary: 's', reasoning_trajectory: 'r',
               thesis_output: 't', outcome_validated: true, confidence_at_creation: 50,
               confidence_at_validation: 70 }],
    });
    const store = createExperienceStore({ pool: pool as any });
    const embedding = new Array(768).fill(0.1);
    const results = await store.findSimilar(embedding, 3);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY embedding <=>'),
      expect.any(Array)
    );
  });
});
