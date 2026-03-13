import { describe, expect, it } from 'vitest';
import { fetchShowHnEvents } from '../src/showhn';

describe('showhn connector', () => {
  it('maps Show HN items to RawEventInput', async () => {
    const mockLoader = async () => [{
      objectID: '99999',
      created_at_i: 1709600000,
      title: 'Show HN: My new dev tool',
      url: 'https://example.com/tool',
      points: 85,
      num_comments: 30,
      story_text: 'I built this tool to help developers...'
    }];

    const events = await fetchShowHnEvents(mockLoader, 25);
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe('showhn');
    expect(events[0]!.source_item_id).toBe('showhn:99999');
    expect(events[0]!.text).toContain('dev tool');
  });

  it('filters items with empty titles', async () => {
    const mockLoader = async () => [
      { objectID: '1', created_at_i: 1709600000, title: '', url: '', points: 10, num_comments: 1 },
      { objectID: '2', created_at_i: 1709600000, title: 'Real title', url: '', points: 20, num_comments: 5 }
    ];

    const events = await fetchShowHnEvents(mockLoader, 25);
    expect(events).toHaveLength(1);
    expect(events[0]!.text).toBe('Real title');
  });
});
