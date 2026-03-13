import { describe, expect, it } from 'vitest';
import { fetchMastodonEvents } from '../src/mastodon';

describe('mastodon connector', () => {
  it('maps statuses to RawEventInput with HTML stripped', async () => {
    const mockLoader = async () => [{
      id: '109876543210',
      created_at: '2026-03-05T10:00:00.000Z',
      content: '<p>Just released my new <a href="#">CLI tool</a> for managing dotfiles!</p>',
      url: 'https://fosstodon.org/@user/109876543210',
      reblogs_count: 5,
      favourites_count: 12,
      replies_count: 3,
      account: { acct: 'user@fosstodon.org' }
    }];

    const events = await fetchMastodonEvents(mockLoader, 30);
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe('mastodon');
    expect(events[0]!.text).not.toContain('<p>');
    expect(events[0]!.text).toContain('CLI tool');
    expect(events[0]!.text).toContain('dotfiles');
  });

  it('filters short content', async () => {
    const mockLoader = async () => [{
      id: '1',
      created_at: '2026-03-05T10:00:00.000Z',
      content: '<p>Hi</p>',
      url: 'https://fosstodon.org/@u/1',
      reblogs_count: 0,
      favourites_count: 0,
      replies_count: 0,
      account: { acct: 'u' }
    }];

    const events = await fetchMastodonEvents(mockLoader, 30);
    expect(events).toHaveLength(0);
  });
});
