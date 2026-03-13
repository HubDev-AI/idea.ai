import { describe, expect, it } from 'vitest';
import { runTwitterByoConnector } from '../src/twitter_byo';

describe('twitter BYO connector', () => {
  it('skips when X_BEARER_TOKEN is missing', async () => {
    const result = await runTwitterByoConnector({});
    expect(result.status).toBe('skipped');
    expect(result.events).toHaveLength(0);
  });

  it('returns events when token is provided', async () => {
    const mockLoader = async () => [{
      source: 'twitter_trending' as const,
      source_item_id: 'twitter:123',
      source_timestamp: '2026-03-01T00:00:00Z',
      text: 'someone should build an app for this',
      url: 'https://x.com/i/status/123'
    }];

    const result = await runTwitterByoConnector(
      { X_BEARER_TOKEN: 'test-token', X_DAILY_BUDGET_USD: '10' },
      mockLoader
    );

    expect(result.status).toBe('active');
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.source).toBe('twitter_trending');
  });
});
