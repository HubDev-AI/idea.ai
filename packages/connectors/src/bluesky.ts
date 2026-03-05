import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput } from './common/http';

type BlueskyPost = {
  uri: string;
  cid: string;
  author: { handle: string };
  record: { text: string; createdAt: string };
  likeCount?: number;
  repostCount?: number;
  indexedAt: string;
};

type BlueskySearchResponse = {
  posts: BlueskyPost[];
};

type BlueskyLoaderFn = () => Promise<BlueskyPost[]>;

const QUERIES = ['building in public', 'launched my app', 'side project launch', 'dev tool', 'open source project'];

const defaultLoader: BlueskyLoaderFn = async () => {
  const allPosts: BlueskyPost[] = [];

  for (const query of QUERIES) {
    try {
      const response = await fetchJsonWithRetry<BlueskySearchResponse>(
        `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=10`,
        { init: { headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' } } }
      );
      allPosts.push(...(response.posts ?? []));
    } catch {
      // Skip failed query
    }
  }

  // Deduplicate by uri
  const seen = new Set<string>();
  return allPosts.filter((p) => {
    if (seen.has(p.uri)) return false;
    seen.add(p.uri);
    return true;
  });
};

export const fetchBlueskyEvents = async (
  loadItems: BlueskyLoaderFn = defaultLoader,
  limit = OPEN_CONNECTOR_LIMITS.bluesky
): Promise<RawEventInput[]> => {
  const items = await loadItems();

  return items
    .slice(0, limit)
    .filter((item) => item.uri && item.record?.text)
    .map((item) => {
      // Convert AT URI to web URL: at://did:plc:xxx/app.bsky.feed.post/yyy -> https://bsky.app/profile/handle/post/yyy
      const rkey = item.uri.split('/').pop() ?? '';
      const webUrl = `https://bsky.app/profile/${item.author.handle}/post/${rkey}`;

      return {
        source: 'bluesky',
        source_item_id: `bsky:${item.cid}`,
        source_timestamp: item.record.createdAt || item.indexedAt || new Date().toISOString(),
        text: item.record.text.slice(0, 2000),
        url: webUrl
      };
    })
    .filter((item) => item.text.length > 10);
};
