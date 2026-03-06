import { describe, expect, it, vi } from 'vitest';
import { fetchStackOverflow } from '../src/stackoverflow.js';

describe('stackoverflow connector', () => {
  it('parses API response into events', async () => {
    const mockResponse = {
      items: [{
        question_id: 12345,
        title: 'How to handle SOC2 compliance in microservices?',
        creation_date: 1709700000,
        link: 'https://stackoverflow.com/q/12345',
        tags: ['compliance', 'microservices'],
        score: 15,
      }],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const events = await fetchStackOverflow({ fetchImpl: mockFetch as any });
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('stackoverflow');
    expect(events[0].source_item_id).toBe('so-12345');
    expect(events[0].text).toContain('SOC2 compliance');
  });

  it('returns empty on API error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const events = await fetchStackOverflow({ fetchImpl: mockFetch as any });
    expect(events).toEqual([]);
  });
});
