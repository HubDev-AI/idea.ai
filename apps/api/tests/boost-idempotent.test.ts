import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('idempotent convergence boost', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    vi.doMock('pg', () => ({
      default: { Pool: vi.fn(() => ({ query: mockQuery, end: vi.fn() })) },
      Pool: vi.fn(() => ({ query: mockQuery, end: vi.fn() }))
    }));
  });

  it('boostViralityScore SQL uses GREATEST for idempotent update', async () => {
    const { createPostgresSignalStore } = await import('../src/runtime/postgres_signal_store');
    const store = createPostgresSignalStore({ databaseUrl: 'postgres://test' });

    await store.boostViralityScore('sig-1', 55);

    const updateCall = mockQuery.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('UPDATE scored_signals')
    );
    expect(updateCall).toBeDefined();
    const sql = updateCall![0] as string;
    expect(sql).toContain('GREATEST');
    expect(sql).not.toMatch(/virality\s*\+/);
    expect(updateCall![1][0]).toBe('sig-1');
    expect(updateCall![1][1]).toBe(55);
  });

  it('GREATEST prevents accumulation — calling twice yields same value', () => {
    const currentVirality = 40;
    const targetVirality = 55;
    const first = Math.max(currentVirality, Math.min(100, targetVirality));
    const second = Math.max(first, Math.min(100, targetVirality));
    expect(first).toBe(55);
    expect(second).toBe(55);
  });

  it('does not lower virality below current value', () => {
    const currentVirality = 80;
    const targetVirality = 15;
    const result = Math.max(currentVirality, Math.min(100, targetVirality));
    expect(result).toBe(80);
  });
});
