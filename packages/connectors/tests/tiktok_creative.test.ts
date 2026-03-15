import { describe, expect, it, vi } from 'vitest';
import { fetchTikTokCreative } from '../src/tiktok_creative';

describe('tiktok_creative connector', () => {
  it('parses trending topics into RawEventInput', async () => {
    const mockData = {
      data: {
        trend_list: [
          { hashtag_name: 'aidatingapp', video_count: 150000, view_count: 5000000 },
          { hashtag_name: 'mealprephack', video_count: 80000, view_count: 2000000 },
        ],
      },
    };

    const mockLoader = vi.fn().mockResolvedValue(mockData);
    const results = await fetchTikTokCreative(mockLoader, 10);

    expect(results).toHaveLength(2);
    expect(results[0]!.source).toBe('tiktok_creative');
    expect(results[0]!.text).toContain('aidatingapp');
    expect(results[0]!.engagement_count).toBe(5000000);
    expect(results[0]!.source_item_id).toMatch(/^tiktok:/);
  });

  it('returns empty array when API structure changes', async () => {
    const mockLoader = vi.fn().mockResolvedValue({ data: {} });
    const results = await fetchTikTokCreative(mockLoader, 10);
    expect(results).toEqual([]);
  });
});
