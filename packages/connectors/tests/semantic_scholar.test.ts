import { describe, expect, it, vi } from 'vitest';
import { fetchSemanticScholar } from '../src/semantic_scholar.js';

describe('fetchSemanticScholar', () => {
  it('returns events from paper search results', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            paperId: 'abc123',
            title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
            abstract: 'We explore a general-purpose fine-tuning recipe...',
            citationCount: 450,
            year: 2025,
            venue: 'NeurIPS',
            url: 'https://api.semanticscholar.org/abc123',
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const events = await fetchSemanticScholar({
      topics: ['retrieval augmented generation'],
      fetchImpl: mockFetch,
    });

    expect(events.length).toBe(1);
    expect(events[0].source).toBe('semantic_scholar');
    expect(events[0].text).toContain('Retrieval-Augmented Generation');
    expect(events[0].engagement_count).toBe(450);
  });

  it('returns empty array on API failure', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const events = await fetchSemanticScholar({ fetchImpl: mockFetch });
    expect(events).toEqual([]);
  });

  it('filters out papers with no title', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { paperId: 'x1', title: null, abstract: null, citationCount: 10, year: 2025 },
          { paperId: 'x2', title: 'Valid Paper', abstract: 'text', citationCount: 20, year: 2025, url: 'https://example.com' },
        ],
      }),
    })) as unknown as typeof fetch;

    const events = await fetchSemanticScholar({
      topics: ['test'],
      fetchImpl: mockFetch,
    });

    expect(events.length).toBe(1);
    expect(events[0].text).toContain('Valid Paper');
  });
});
