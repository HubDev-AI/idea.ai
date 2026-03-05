import { describe, expect, it } from 'vitest';
import type { RawEventInput } from '../src/common/http';
import { fetchProductHunt } from '../src/producthunt';

describe('producthunt connector', () => {
  it('parses Atom feed entries', async () => {
    const loader = async (_limit: number): Promise<RawEventInput[]> => [
      {
        source: 'producthunt',
        source_item_id: 'ph:https://www.producthunt.com/posts/compliancebot',
        source_timestamp: '2026-02-25T10:00:00.000Z',
        text: 'ComplianceBot: Automate your SOC2 audits',
        url: 'https://www.producthunt.com/posts/compliancebot'
      },
      {
        source: 'producthunt',
        source_item_id: 'ph:https://www.producthunt.com/posts/viralloop',
        source_timestamp: '2026-02-25T09:00:00.000Z',
        text: 'ViralLoop: Growth engine for SaaS',
        url: 'https://www.producthunt.com/posts/viralloop'
      }
    ];

    const results = await fetchProductHunt(loader);

    expect(results).toHaveLength(2);
    expect(results[0]!.source).toBe('producthunt');
    expect(results[0]!.text).toContain('ComplianceBot');
    expect(results[0]!.url).toBe('https://www.producthunt.com/posts/compliancebot');
    expect(results[1]!.text).toContain('ViralLoop');
  });

  it('respects limit parameter', async () => {
    const loader = async (_limit: number): Promise<RawEventInput[]> => [
      { source: 'producthunt', source_item_id: 'ph:1', source_timestamp: new Date().toISOString(), text: 'A', url: '' },
      { source: 'producthunt', source_item_id: 'ph:2', source_timestamp: new Date().toISOString(), text: 'B', url: '' },
      { source: 'producthunt', source_item_id: 'ph:3', source_timestamp: new Date().toISOString(), text: 'C', url: '' }
    ];

    const results = await fetchProductHunt(loader, 2);
    expect(results).toHaveLength(2);
  });
});
