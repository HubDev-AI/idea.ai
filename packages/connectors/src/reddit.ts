import type { RawEventInput } from './common/http';
import { fetchJsonWithRetry } from './common/http';

export const DEFAULT_SUBREDDITS = [
  'SaaS',
  'startups',
  'smallbusiness',
  'Entrepreneur',
  'apps',
  'socialmedia',
  'productivity',
  'dating',
  'sideproject',
  'AppIdeas',
  'InternetIsBeautiful'
];

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
  let failedCount = 0;

  for (const sub of subreddits) {
    try {
      const data = await fetchJsonWithRetry<RedditListingResponse>(
        `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=${Math.min(100, Math.max(1, limit))}`,
        {
          ...(options.fetchImpl !== undefined && { fetchImpl: options.fetchImpl }),
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
    } catch (error) {
      failedCount++;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[reddit] failed to fetch r/${sub}: ${message}`);
    }
  }

  if (failedCount > 0 && results.length === 0) {
    console.warn(`[reddit] all ${failedCount} subreddits failed, returning empty`);
  }

  return results;
};
