import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/* Mock pg.Pool so createPostgresMemoryStore never hits a real DB      */
/* ------------------------------------------------------------------ */

const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn().mockResolvedValue({
  query: mockQuery,
  release: mockRelease
});
const mockEnd = vi.fn();
const mockPool = { query: mockQuery, connect: mockConnect, end: mockEnd } as any;

vi.doMock('pg', () => ({
  default: { Pool: vi.fn(() => mockPool) },
  Pool: vi.fn(() => mockPool)
}));

/* Mock buildLocalEmbedding (used by retriever.findSimilar) so we
   don't depend on the real hashing implementation in tests */
vi.doMock('../src/jobs/memory_index', () => ({
  buildLocalEmbedding: vi.fn(() => Array.from({ length: 32 }, () => 0.1))
}));

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('PostgresMemoryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-wire mockConnect default after clearAllMocks
    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease
    });
  });

  /* ---- ping ---- */

  it('ping succeeds when SELECT 1 resolves', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
    await expect(store.ping()).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1');
  });

  it('ping rejects when pool.query throws', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
    await expect(store.ping()).rejects.toThrow('connection refused');
  });

  /* ---- listAllSignals ---- */

  it('listAllSignals returns mapped rows with numeric coercion', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          signal_id: 's1',
          topic: 'ai',
          source: 'hn',
          canonical_text: 'test signal',
          observed_at: new Date('2026-01-01T00:00:00Z'),
          pain: '70',
          timing: '80',
          buildability: '60',
          blended: '72'
        }
      ]
    });
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
    const signals = await store.listAllSignals(10);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toEqual({
      signal_id: 's1',
      topic: 'ai',
      source: 'hn',
      canonical_text: 'test signal',
      observed_at: '2026-01-01T00:00:00.000Z',
      pain: 70,
      timing: 80,
      buildability: 60,
      blended: 72
    });
    // Verify query used the limit parameter
    expect(mockQuery.mock.calls[0][1]).toEqual([10]);
  });

  it('listAllSignals defaults limit to 500', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
    await store.listAllSignals();
    expect(mockQuery.mock.calls[0][1]).toEqual([500]);
  });

  it('listAllSignals coerces NaN/null values to 0', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          signal_id: 's2',
          topic: 't',
          source: 's',
          canonical_text: 'text',
          observed_at: new Date('2026-06-15T00:00:00Z'),
          pain: 'NaN',
          timing: null,
          buildability: undefined,
          blended: ''
        }
      ]
    });
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
    const signals = await store.listAllSignals();
    expect(signals[0].pain).toBe(0);
    expect(signals[0].timing).toBe(0);
    expect(signals[0].buildability).toBe(0);
    expect(signals[0].blended).toBe(0);
  });

  /* ---- save ---- */

  it('save commits a transaction using pool.connect', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    // BEGIN, upsertSignalMemory INSERT, upsertSignalMemory INSERT (embedding),
    // upsertTrendWindows (3 windows), COMMIT
    mockQuery.mockResolvedValue({ rows: [] });
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });

    const entry = {
      memoryRecord: {
        signal_id: 's1',
        topic: 'ai',
        source: 'hn',
        canonical_text: 'test',
        observed_at: '2026-01-01T00:00:00Z',
        pain: 70,
        timing: 80,
        buildability: 60,
        blended: 72
      },
      embeddingRecord: {
        signal_id: 's1',
        embedding: [0.1, 0.2, 0.3],
        model: 'test-model'
      }
    };

    await store.save(entry);

    expect(mockConnect).toHaveBeenCalledTimes(1);
    // First call: BEGIN
    expect(mockQuery.mock.calls[0][0]).toBe('BEGIN');
    // Last call: COMMIT
    expect(mockQuery.mock.calls[mockQuery.mock.calls.length - 1][0]).toBe('COMMIT');
    // client.release called in finally block
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('save skips embedding insert when embedding is null', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    mockQuery.mockResolvedValue({ rows: [] });
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });

    const entry = {
      memoryRecord: {
        signal_id: 's2',
        topic: 'ai',
        source: 'hn',
        canonical_text: 'test',
        observed_at: '2026-01-01T00:00:00Z',
        pain: 50,
        timing: 50,
        buildability: 50,
        blended: 50
      },
      embeddingRecord: {
        signal_id: 's2',
        embedding: null,
        model: 'local-hash-v1'
      }
    };

    await store.save(entry);

    // Should have: BEGIN, signal_memory INSERT, 3x trend_windows, COMMIT = 6 calls
    // (no signal_embeddings INSERT because embedding is null)
    const queries = mockQuery.mock.calls.map((c: any[]) => c[0] as string);
    const embeddingInserts = queries.filter((q: string) => q.includes('signal_embeddings'));
    expect(embeddingInserts).toHaveLength(0);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('save rolls back and re-throws on error', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    // BEGIN succeeds, signal_memory INSERT throws
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockRejectedValueOnce(new Error('unique violation')); // INSERT
    // ROLLBACK succeeds
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const mockLogger = {
      error: vi.fn()
    } as any;

    const store = createPostgresMemoryStore({
      databaseUrl: 'postgres://test',
      logger: mockLogger
    });

    const entry = {
      memoryRecord: {
        signal_id: 's1',
        topic: 'ai',
        source: 'hn',
        canonical_text: 'test',
        observed_at: '2026-01-01T00:00:00Z',
        pain: 50,
        timing: 50,
        buildability: 50,
        blended: 50
      },
      embeddingRecord: {
        signal_id: 's1',
        embedding: [0.1],
        model: 'test'
      }
    };

    await expect(store.save(entry)).rejects.toThrow('unique violation');

    // ROLLBACK should have been called
    const queries = mockQuery.mock.calls.map((c: any[]) => c[0] as string);
    expect(queries).toContain('ROLLBACK');
    // Logger should have been notified
    expect(mockLogger.error).toHaveBeenCalledWith(
      'postgres_memory_store',
      'persist failed',
      expect.objectContaining({ signal_id: 's1', error: 'unique violation' })
    );
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  /* ---- retriever.findSimilar ---- */

  it('retriever.findSimilar returns mapped rows', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          signal_id: 'sim1',
          distance: '0.1234',
          pain: '60',
          timing: '70',
          source: 'gh',
          observed_at: new Date('2026-03-01T00:00:00Z')
        }
      ]
    });
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
    const results = await store.retriever.findSimilar({
      canonicalText: 'test query',
      topic: 'ai',
      source: 'gh'
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      signal_id: 'sim1',
      distance: 0.1234,
      pain: 60,
      timing: 70,
      source: 'gh',
      observed_at: '2026-03-01T00:00:00.000Z'
    });
    // Verify query params include embedding vector, topic, source, limit
    const params = mockQuery.mock.calls[0][1];
    expect(params[1]).toBe('ai');   // topic
    expect(params[2]).toBe('gh');   // source
    expect(params[3]).toBe(8);     // default topK
  });

  it('retriever.findSimilar respects custom topK', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
    await store.retriever.findSimilar({
      canonicalText: 'test',
      topic: 't',
      source: 's',
      topK: 3
    });
    const params = mockQuery.mock.calls[0][1];
    expect(params[3]).toBe(3);
  });

  /* ---- retriever.getTrendWindows ---- */

  it('getTrendWindows returns all 3 windows in order', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    mockQuery.mockResolvedValueOnce({
      rows: [
        { topic: 'ai', source: 'hn', window: '7d', count_signals: 5, avg_pain: '72.50', avg_timing: '68.00' },
        { topic: 'ai', source: 'hn', window: '30d', count_signals: 20, avg_pain: '65.00', avg_timing: '60.00' },
        { topic: 'ai', source: 'hn', window: '90d', count_signals: 50, avg_pain: '60.00', avg_timing: '55.00' }
      ]
    });
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
    const windows = await store.retriever.getTrendWindows({
      canonicalText: 'irrelevant',
      topic: 'ai',
      source: 'hn'
    });

    expect(windows).toHaveLength(3);
    expect(windows[0]).toEqual({
      topic: 'ai',
      source: 'hn',
      window: '7d',
      count_signals: 5,
      avg_pain: 72.5,
      avg_timing: 68
    });
    expect(windows[1].window).toBe('30d');
    expect(windows[2].window).toBe('90d');
  });

  it('getTrendWindows fills missing windows with zeroes', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    // Return only 7d; 30d and 90d are missing
    mockQuery.mockResolvedValueOnce({
      rows: [
        { topic: 'ai', source: 'hn', window: '7d', count_signals: 2, avg_pain: '50', avg_timing: '50' }
      ]
    });
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
    const windows = await store.retriever.getTrendWindows({
      canonicalText: 'irrelevant',
      topic: 'ai',
      source: 'hn'
    });

    expect(windows).toHaveLength(3);
    // 7d found
    expect(windows[0].count_signals).toBe(2);
    // 30d fallback
    expect(windows[1]).toEqual({
      topic: 'ai',
      source: 'hn',
      window: '30d',
      count_signals: 0,
      avg_pain: 0,
      avg_timing: 0
    });
    // 90d fallback
    expect(windows[2].window).toBe('90d');
    expect(windows[2].count_signals).toBe(0);
  });

  /* ---- querySignals ---- */

  describe('querySignals', () => {
    it('returns paginated signals within time window', async () => {
      const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 2 }] }); // count query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            signal_id: 's1', topic: 'ai', source: 'hn',
            canonical_text: 'AI tool', observed_at: new Date('2026-02-25'),
            pain: '75', timing: '80', buildability: '60', blended: '73'
          },
          {
            signal_id: 's2', topic: 'hr', source: 'greenhouse',
            canonical_text: 'HR gap', observed_at: new Date('2026-02-24'),
            pain: '60', timing: '50', buildability: '70', blended: '58'
          }
        ]
      });
      const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
      const result = await store.querySignals({ windowDays: 7, page: 1, pageSize: 20 });
      expect(result.items).toHaveLength(2);
      expect(result.totalItems).toBe(2);
      expect(result.page).toBe(1);
      expect(result.hasNext).toBe(false);
    });

    it('filters by source', async () => {
      const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
      mockQuery.mockResolvedValueOnce({
        rows: [{
          signal_id: 's1', topic: 'ai', source: 'hn',
          canonical_text: 'test', observed_at: new Date(),
          pain: '70', timing: '80', buildability: '60', blended: '72'
        }]
      });
      const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
      const result = await store.querySignals({ windowDays: 7, page: 1, pageSize: 20, source: 'hn' });
      expect(result.items).toHaveLength(1);
      // Verify SQL contains source filter
      const countCall = mockQuery.mock.calls[0];
      expect(countCall[0]).toContain('source');
      expect(countCall[1]).toContain('hn');
    });

    it('filters by thesis key via evidence join', async () => {
      const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
      mockQuery.mockResolvedValueOnce({
        rows: [{
          signal_id: 's1', topic: 'ai', source: 'hn',
          canonical_text: 'test', observed_at: new Date(),
          pain: '70', timing: '80', buildability: '60', blended: '72'
        }]
      });
      const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
      const result = await store.querySignals({ windowDays: 7, page: 1, pageSize: 20, thesisKey: 'remote-dev-tools' });
      expect(result.items).toHaveLength(1);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('thesis_evidence');
      expect(sql).toContain('thesis_candidates');
    });
  });

  /* ---- close ---- */

  it('close calls pool.end', async () => {
    const { createPostgresMemoryStore } = await import('../src/runtime/postgres_memory_store');
    const store = createPostgresMemoryStore({ databaseUrl: 'postgres://test' });
    await store.close();
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });
});
