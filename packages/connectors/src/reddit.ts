import type { RawEventInput } from './common/http';
import { fetchJsonWithRetry } from './common/http';

export const DEFAULT_SUBREDDITS = ['SaaS', 'startups', 'smallbusiness', 'Entrepreneur'];

type RedditPost = {
  data: {
    id: string;
    title: string;
    selftext: string;
    permalink: string;
    created_utc: number;
    subreddit: string;
  };
};

type RedditListingResponse = {
  data: {
    children: RedditPost[];
  };
};

export const fetchReddit = async (options: {
  subreddits?: string[];
  limit?: number;
  fetchImpl?: typeof fetch;
}): Promise<RawEventInput[]> => {
  const subreddits = options.subreddits ?? DEFAULT_SUBREDDITS;
  const limit = options.limit ?? 25;
  const results: RawEventInput[] = [];

  for (const sub of subreddits) {
    try {
      const data = await fetchJsonWithRetry<RedditListingResponse>(
        `https://www.reddit.com/r/${sub}/new.json?limit=${limit}`,
        {
          fetchImpl: options.fetchImpl,
          init: { headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' } }
        }
      );

      for (const post of data.data.children) {
        const { id, title, selftext, permalink, created_utc } = post.data;
        results.push({
          source: 'reddit',
          source_item_id: `reddit:${id}`,
          source_timestamp: new Date(created_utc * 1000).toISOString(),
          text: `${title}\n${selftext}`.slice(0, 2000),
          url: `https://www.reddit.com${permalink}`
        });
      }
    } catch {
      // Skip failed subreddit, don't crash entire connector
    }
  }

  return results;
};
