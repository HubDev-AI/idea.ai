import { describe, expect, it, vi } from 'vitest';
import { fetchNpmTrends } from '../src/npm_trends';

const makeFetch = (responses: Record<string, { downloads: number }>) => {
  return vi.fn(async (url: string) => ({
    ok: true,
    json: async () => {
      const pkg = url.split('/').pop() ?? '';
      return responses[pkg] ?? { downloads: 0 };
    },
  })) as unknown as typeof fetch;
};

describe('fetchNpmTrends', () => {
  it('returns events for packages with download data', async () => {
    const mockFetch = makeFetch({
      langchain: { downloads: 50000 },
      llamaindex: { downloads: 30000 },
    });

    const events = await fetchNpmTrends({
      categories: { 'ai-agents': ['langchain', 'llamaindex'] },
      fetchImpl: mockFetch,
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].source).toBe('npm_trends');
    expect(events[0].text).toContain('ai-agents');
  });

  it('returns empty array when fetch fails', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const events = await fetchNpmTrends({ fetchImpl: mockFetch });
    expect(events).toEqual([]);
  });

  it('uses source_item_id with category and date', async () => {
    const mockFetch = makeFetch({ langchain: { downloads: 50000 } });
    const events = await fetchNpmTrends({
      categories: { 'ai-agents': ['langchain'] },
      fetchImpl: mockFetch,
    });

    expect(events[0].source_item_id).toMatch(/^npm:ai-agents:\d{4}-\d{2}-\d{2}$/);
  });
});
