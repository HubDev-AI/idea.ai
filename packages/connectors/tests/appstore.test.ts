import { describe, expect, it, vi } from 'vitest';
import { fetchAppStoreTrending } from '../src/appstore';

describe('appstore connector', () => {
  it('fetches and maps iTunes RSS entries to RawEventInput', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({
        feed: {
          entry: [{
            'im:name': { label: 'Cool App' },
            id: { attributes: { 'im:id': '12345' } },
            summary: { label: 'A cool social app' },
            link: [{ attributes: { href: 'https://apps.apple.com/app/12345' } }],
            'im:releaseDate': { label: '2026-03-01T00:00:00Z' },
            category: { attributes: { label: 'Social Networking' } }
          }]
        }
      }), { status: 200 }))
    );

    const events = await fetchAppStoreTrending({ categories: ['social-networking'], fetchImpl: mockFetch });

    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe('appstore_trending');
    expect(events[0]!.source_item_id).toBe('appstore:12345');
    expect(events[0]!.text).toContain('Cool App');
  });
});
