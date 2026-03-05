import { describe, expect, it } from 'vitest';
import { fetchLobstersEvents } from '../src/lobsters';

describe('lobsters connector', () => {
  it('maps JSON items to RawEventInput', async () => {
    const mockLoader = async () => [{
      short_id: 'abc123',
      created_at: '2026-03-05T10:00:00.000Z',
      title: 'A new CLI tool for managing dotfiles',
      url: 'https://example.com/dotfiles',
      score: 42,
      comment_count: 8,
      tags: ['devops', 'programming']
    }];

    const events = await fetchLobstersEvents(mockLoader, 25);
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('lobsters');
    expect(events[0].source_item_id).toBe('lobsters:abc123');
    expect(events[0].text).toContain('dotfiles');
    expect(events[0].url).toBe('https://example.com/dotfiles');
  });

  it('respects limit', async () => {
    const mockLoader = async () => Array.from({ length: 50 }, (_, i) => ({
      short_id: `id${i}`,
      created_at: new Date().toISOString(),
      title: `Story ${i}`,
      url: `https://example.com/${i}`,
      score: 10,
      comment_count: 2,
      tags: ['programming']
    }));

    const events = await fetchLobstersEvents(mockLoader, 5);
    expect(events).toHaveLength(5);
  });

  it('falls back to lobste.rs URL when url is empty', async () => {
    const mockLoader = async () => [{
      short_id: 'xyz',
      created_at: '2026-03-05T10:00:00.000Z',
      title: 'Self post on Lobsters',
      url: '',
      score: 5,
      comment_count: 1,
      tags: ['programming']
    }];

    const events = await fetchLobstersEvents(mockLoader, 25);
    expect(events[0].url).toBe('https://lobste.rs/s/xyz');
  });
});
