import { describe, expect, it, vi } from 'vitest';
import { fetchStackOverflow } from '../src/stackoverflow.js';

describe('fetchStackOverflow', () => {
  it('returns events with source stackoverflow', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          {
            question_id: 123,
            title: 'How to handle multi-tenant DB migrations?',
            tags: ['prisma', 'postgresql', 'multi-tenancy'],
            creation_date: Math.floor(Date.now() / 1000),
            link: 'https://stackoverflow.com/q/123',
            view_count: 500,
            answer_count: 0,
            score: 15,
            is_answered: false,
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const events = await fetchStackOverflow({ fetchImpl: mockFetch });
    expect(events.length).toBe(1);
    expect(events[0]!.source).toBe('stackoverflow');
    expect(events[0]!.text).toContain('prisma');
    expect(events[0]!.text).toContain('[UNANSWERED]');
    expect(events[0]!.engagement_count).toBeDefined();
  });

  it('includes engagement_count from views + score', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          {
            question_id: 456,
            title: 'Auth issue',
            tags: ['auth0'],
            creation_date: Math.floor(Date.now() / 1000),
            link: 'https://stackoverflow.com/q/456',
            view_count: 1000,
            answer_count: 2,
            score: 25,
            is_answered: true,
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const events = await fetchStackOverflow({ fetchImpl: mockFetch });
    expect(events[0]!.engagement_count).toBe(1025);
  });

  it('returns empty array on API failure', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const events = await fetchStackOverflow({ fetchImpl: mockFetch });
    expect(events).toEqual([]);
  });
});
