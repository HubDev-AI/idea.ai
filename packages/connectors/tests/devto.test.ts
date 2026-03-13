import { describe, expect, it } from 'vitest';
import { fetchDevtoEvents } from '../src/devto';

describe('devto connector', () => {
  it('maps articles to RawEventInput', async () => {
    const mockLoader = async () => [{
      id: 12345,
      title: 'Building a CLI in Rust',
      description: 'How I built my first Rust CLI tool',
      url: 'https://dev.to/user/building-a-cli-in-rust',
      published_at: '2026-03-05T10:00:00Z',
      public_reactions_count: 42,
      comments_count: 8,
      tag_list: ['rust', 'cli']
    }];

    const events = await fetchDevtoEvents(mockLoader, 30);
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe('devto');
    expect(events[0]!.source_item_id).toBe('devto:12345');
    expect(events[0]!.text).toContain('Building a CLI in Rust');
    expect(events[0]!.text).toContain('How I built');
  });

  it('respects limit', async () => {
    const mockLoader = async () => Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      title: `Article ${i}`,
      description: `Desc ${i}`,
      url: `https://dev.to/a/${i}`,
      published_at: new Date().toISOString(),
      public_reactions_count: 10,
      comments_count: 2,
      tag_list: ['devtools']
    }));

    const events = await fetchDevtoEvents(mockLoader, 5);
    expect(events).toHaveLength(5);
  });
});
