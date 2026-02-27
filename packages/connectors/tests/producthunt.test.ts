import { describe, expect, it, vi } from 'vitest';
import { fetchProductHunt } from '../src/producthunt';

describe('producthunt connector', () => {
  it('fetches recent posts from PH API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          posts: {
            edges: [
              {
                node: {
                  id: 'ph-123',
                  name: 'ComplianceBot',
                  tagline: 'Automate your SOC2 audits',
                  url: 'https://www.producthunt.com/posts/compliancebot',
                  createdAt: '2026-02-25T10:00:00Z',
                  votesCount: 42,
                  topics: { edges: [{ node: { name: 'SaaS' } }] }
                }
              }
            ]
          }
        }
      })
    });

    const results = await fetchProductHunt({ fetchImpl: mockFetch, token: 'test-token' });

    expect(results).toHaveLength(1);
    expect(results[0]!.source).toBe('producthunt');
    expect(results[0]!.text).toContain('ComplianceBot');
  });
});
