import { describe, it, expect, vi } from 'vitest';
import { fetchCrunchbase } from '../src/crunchbase_byo.js';

describe('crunchbase byo connector', () => {
  it('returns empty when no API key', async () => {
    const events = await fetchCrunchbase({ apiKey: '' });
    expect(events).toEqual([]);
  });

  it('parses API response', async () => {
    const mockResponse = {
      entities: [{
        identifier: { value: 'test-startup', permalink: 'test-startup' },
        properties: {
          short_description: 'AI compliance tool',
          founded_on: '2025-01-01',
          categories: [{ value: 'SaaS' }],
          funding_total: { value_usd: 5000000 },
        },
      }],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const events = await fetchCrunchbase({ apiKey: 'test-key', fetchImpl: mockFetch as any });
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('crunchbase');
    expect(events[0].text).toContain('AI compliance tool');
  });
});
