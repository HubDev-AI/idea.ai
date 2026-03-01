import { describe, expect, it } from 'vitest';
import { fetchIndieHackersEvents } from '../src/indiehackers';

describe('indiehackers connector', () => {
  it('maps RSS items to RawEventInput', async () => {
    const mockLoader = async () => [{
      source: 'indiehackers' as const,
      source_item_id: 'ih:https://www.indiehackers.com/post/test',
      source_timestamp: '2026-03-01T00:00:00.000Z',
      text: 'Building a viral app\nHow I got to 10k users',
      url: 'https://www.indiehackers.com/post/test'
    }];

    const events = await fetchIndieHackersEvents(mockLoader, 20);

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('indiehackers');
    expect(events[0].text).toContain('Building a viral app');
  });

  it('respects limit', async () => {
    const mockLoader = async () => Array.from({ length: 50 }, (_, i) => ({
      source: 'indiehackers' as const,
      source_item_id: `ih:${i}`,
      source_timestamp: new Date().toISOString(),
      text: `Post ${i}`,
      url: `https://www.indiehackers.com/post/${i}`
    }));

    const events = await fetchIndieHackersEvents(mockLoader, 5);
    expect(events).toHaveLength(5);
  });
});
