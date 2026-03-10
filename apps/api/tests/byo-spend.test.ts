import { describe, it, expect, vi } from 'vitest';

describe('BYO spend store', () => {
  it('records spend and returns cumulative total', async () => {
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [] })  // first record call
      .mockResolvedValueOnce({ rows: [{ spent_usd: '0.03' }] }); // getSpent

    const { createByoSpendStore } = await import('../src/runtime/byo_spend_store');
    const store = createByoSpendStore({ pool: { query: mockQuery } as any });

    await store.record('exa_byo', 0.03);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO byo_spend');

    const spent = await store.getSpent('exa_byo');
    expect(spent).toBe(0.03);
  });
});
