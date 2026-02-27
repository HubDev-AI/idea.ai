import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SUBREDDITS, fetchReddit } from '../src/reddit';

describe('reddit connector', () => {
  it('fetches posts from public subreddit JSON API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          children: [
            {
              data: {
                id: 'abc123',
                title: 'Why is SOC2 so painful?',
                selftext: 'We spent 3 months on compliance...',
                permalink: '/r/SaaS/comments/abc123/why_is_soc2_so_painful/',
                created_utc: 1740000000,
                subreddit: 'SaaS'
              }
            }
          ]
        }
      })
    });

    const results = await fetchReddit({
      subreddits: ['SaaS'],
      limit: 10,
      fetchImpl: mockFetch
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.source).toBe('reddit');
    expect(results[0]!.source_item_id).toBe('reddit:abc123');
    expect(results[0]!.text).toContain('SOC2');
    expect(results[0]!.url).toContain('reddit.com');
  });

  it('has sensible default subreddits', () => {
    expect(DEFAULT_SUBREDDITS).toContain('SaaS');
    expect(DEFAULT_SUBREDDITS).toContain('startups');
  });
});
