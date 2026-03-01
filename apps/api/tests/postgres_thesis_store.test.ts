import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPostgresThesisStore } from '../src/runtime/postgres_thesis_store';

const mockQuery = vi.fn();
const mockPool = { query: mockQuery, end: vi.fn() } as any;

describe('PostgresThesisStore', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('list returns rows sorted by confidence desc', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { canonical_key: 'k1', title: 'T1', topic: 'ai', status: 'promoted', confidence: '80.00',
          problem_statement: 'p1', target_buyer: 'b1', proposed_solution: 's1',
          first_seen_at: new Date(), last_seen_at: new Date(), evidence_count: 3, source_count: 2 }
      ]
    });
    const store = createPostgresThesisStore({ pool: mockPool });
    const result = await store.list();
    expect(result).toHaveLength(1);
    expect(result[0]!.canonicalKey).toBe('k1');
    expect(result[0]!.confidence).toBe(80);
  });

  it('list with status filter adds WHERE clause', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const store = createPostgresThesisStore({ pool: mockPool });
    await store.list({ status: 'promoted' });
    expect(mockQuery.mock.calls[0]![1]).toEqual(['promoted']);
    expect(mockQuery.mock.calls[0]![0]).toContain('WHERE');
  });

  it('getByKey returns null when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const store = createPostgresThesisStore({ pool: mockPool });
    const result = await store.getByKey('missing');
    expect(result).toBeNull();
  });

  it('getByKey returns mapped draft when found', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { canonical_key: 'k2', title: 'T2', topic: 'devops', status: 'watching', confidence: '65.50',
          problem_statement: 'p2', target_buyer: 'b2', proposed_solution: 's2',
          first_seen_at: new Date(), last_seen_at: new Date('2026-01-15T12:00:00Z'), evidence_count: 5, source_count: 3 }
      ]
    });
    const store = createPostgresThesisStore({ pool: mockPool });
    const result = await store.getByKey('k2');
    expect(result).not.toBeNull();
    expect(result!.canonicalKey).toBe('k2');
    expect(result!.title).toBe('T2');
    expect(result!.confidence).toBe(65.5);
    expect(result!.status).toBe('watching');
    expect(result!.latestObservedAt).toBe('2026-01-15T12:00:00.000Z');
  });

  it('upsert calls INSERT ON CONFLICT', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const store = createPostgresThesisStore({ pool: mockPool });
    await store.upsert({
      canonicalKey: 'k1', title: 'T1', topic: 'ai', status: 'candidate',
      confidence: 50, scoreTotal: 50, problemStatement: 'p', targetBuyer: 'b',
      proposedSolution: 's', evidenceCount: 1, avgDemand: 50, avgTiming: 50,
      avgBuildability: 50, avgVirality: 0, latestObservedAt: '2026-01-01T00:00:00Z', evidence: []
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]![0]).toContain('ON CONFLICT');
  });

  it('rowToDraft maps numeric strings correctly via toNumber', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { canonical_key: 'k3', title: 'T3', topic: 'billing', status: 'candidate', confidence: 'NaN',
          problem_statement: 'p3', target_buyer: 'b3', proposed_solution: 's3',
          first_seen_at: new Date(), last_seen_at: new Date(), evidence_count: 0, source_count: 0 }
      ]
    });
    const store = createPostgresThesisStore({ pool: mockPool });
    const result = await store.list();
    expect(result[0]!.confidence).toBe(0);
  });
});
