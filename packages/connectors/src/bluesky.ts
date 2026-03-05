import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput } from './common/http';

type BlueskyFeedPost = {
  post: {
    uri: string;
    cid: string;
    author: { handle: string; displayName?: string };
    record: { text: string; createdAt: string };
    likeCount?: number;
    repostCount?: number;
    replyCount?: number;
    indexedAt: string;
  };
};

type BlueskyFeedResponse = {
  feed: BlueskyFeedPost[];
  cursor?: string;
};

type BlueskyLoaderFn = () => Promise<BlueskyFeedPost[]>;

// "What's Hot" curated feed — no auth required via public API
const WHATS_HOT_FEED = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';

const defaultLoader: BlueskyLoaderFn = async () => {
  const response = await fetchJsonWithRetry<BlueskyFeedResponse>(
    `https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=${encodeURIComponent(WHATS_HOT_FEED)}&limit=30`
  );
  return response.feed ?? [];
};

export const fetchBlueskyEvents = async (
  loadItems: BlueskyLoaderFn = defaultLoader,
  limit = OPEN_CONNECTOR_LIMITS.bluesky
): Promise<RawEventInput[]> => {
  const items = await loadItems();

  return items
    .slice(0, limit)
    .filter((item) => item.post?.uri && item.post?.record?.text)
    .map((item) => {
      const p = item.post;
      const rkey = p.uri.split('/').pop() ?? '';
      const webUrl = `https://bsky.app/profile/${p.author.handle}/post/${rkey}`;

      return {
        source: 'bluesky',
        source_item_id: `bsky:${p.cid}`,
        source_timestamp: p.record.createdAt || p.indexedAt || new Date().toISOString(),
        text: p.record.text.slice(0, 2000),
        url: webUrl,
        engagement_count: (p.likeCount ?? 0) + (p.repostCount ?? 0) + (p.replyCount ?? 0)
      };
    })
    .filter((item) => item.text.length > 10);
};
