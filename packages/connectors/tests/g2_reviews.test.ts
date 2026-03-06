import { describe, it, expect, vi } from 'vitest';
import { fetchG2Trending } from '../src/g2_reviews.js';

describe('g2 connector', () => {
  it('parses category links from HTML', async () => {
    const html = '<a href="/categories/project-management">Project Management</a><a href="/categories/crm">CRM Software</a>';
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(html) });
    const events = await fetchG2Trending({ fetchImpl: mockFetch as any });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].source).toBe('g2_reviews');
  });

  it('returns empty on error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network'));
    const events = await fetchG2Trending({ fetchImpl: mockFetch as any });
    expect(events).toEqual([]);
  });
});
