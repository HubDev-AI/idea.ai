import { describe, expect, it } from 'vitest';
import { fetchBlueskyEvents } from '../src/bluesky';

describe('bluesky connector', () => {
  it('maps feed posts to RawEventInput', async () => {
    const mockLoader = async () => [{
      post: {
        uri: 'at://did:plc:abc123/app.bsky.feed.post/xyz789',
        cid: 'bafyreiblah',
        author: { handle: 'dev.bsky.social' },
        record: {
          text: 'Just launched my side project! A tool for managing bookmarks across browsers.',
          createdAt: '2026-03-05T10:00:00.000Z'
        },
        likeCount: 25,
        repostCount: 5,
        replyCount: 3,
        indexedAt: '2026-03-05T10:00:01.000Z'
      }
    }];

    const events = await fetchBlueskyEvents(mockLoader, 30);
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe('bluesky');
    expect(events[0]!.text).toContain('side project');
    expect(events[0]!.url).toBe('https://bsky.app/profile/dev.bsky.social/post/xyz789');
    expect(events[0]!.engagement_count).toBe(33);
  });

  it('filters short text', async () => {
    const mockLoader = async () => [{
      post: {
        uri: 'at://did:plc:x/app.bsky.feed.post/y',
        cid: 'cid1',
        author: { handle: 'u.bsky' },
        record: { text: 'hi', createdAt: '2026-03-05T10:00:00.000Z' },
        indexedAt: '2026-03-05T10:00:00.000Z'
      }
    }];

    const events = await fetchBlueskyEvents(mockLoader, 30);
    expect(events).toHaveLength(0);
  });
});
