import { describe, expect, it } from 'vitest';
import { fetchHomebrewEvents } from '../src/homebrew';

describe('homebrew connector', () => {
  it('maps analytics items to RawEventInput', async () => {
    const mockLoader = async () => ({
      start_date: '2026-02-03',
      end_date: '2026-03-05',
      total_items: 34780,
      total_count: 100000000,
      items: [
        { number: 1, formula: 'gh', count: '1,234,567', percent: '1.23' },
        { number: 2, formula: 'node', count: '987,654', percent: '0.99' },
        { number: 3, formula: 'ffmpeg', count: '500,000', percent: '0.50' }
      ]
    });

    const events = await fetchHomebrewEvents(mockLoader, 50);
    // gh and node are dev-related, ffmpeg may or may not match (short name)
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!.source).toBe('homebrew');
    expect(events[0]!.source_item_id).toBe('brew:gh');
    expect(events[0]!.text).toContain('gh');
    expect(events[0]!.text).toContain('installs');
    expect(events[0]!.url).toContain('formulae.brew.sh');
  });

  it('filters non-dev formulae', async () => {
    const mockLoader = async () => ({
      start_date: '2026-02-03',
      end_date: '2026-03-05',
      total_items: 1,
      total_count: 100,
      items: [
        { number: 1, formula: 'some-very-long-unrelated-library-name', count: '100', percent: '0.001' }
      ]
    });

    const events = await fetchHomebrewEvents(mockLoader, 50);
    expect(events).toHaveLength(0);
  });
});
