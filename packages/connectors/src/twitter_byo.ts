import { type ByoConnectorResult, evaluateByoGuard } from './byo_guard';
import { fetchJsonWithRetry, type RawEventInput } from './common/http';

type Tweet = {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: { retweet_count: number; like_count: number; reply_count: number };
};

type TwitterSearchResponse = {
  data?: Tweet[];
};

const VIRAL_QUERIES = [
  '"someone should build" OR "wish there was an app" OR "I would pay for"',
  '"need an app" OR "startup idea" OR "build this"'
];

const defaultTwitterLoader = async (apiKey: string): Promise<RawEventInput[]> => {
  const results: RawEventInput[] = [];

  for (const query of VIRAL_QUERIES) {
    try {
      const response = await fetchJsonWithRetry<TwitterSearchResponse>(
        `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10&tweet.fields=created_at,public_metrics`,
        {
          init: {
            headers: { Authorization: `Bearer ${apiKey}` }
          }
        }
      );

      for (const tweet of response.data ?? []) {
        results.push({
          source: 'twitter_trending',
          source_item_id: `twitter:${tweet.id}`,
          source_timestamp: tweet.created_at ?? new Date().toISOString(),
          text: tweet.text,
          url: `https://x.com/i/status/${tweet.id}`
        });
      }
    } catch {
      // Skip failed query, continue with next
    }
  }

  return results;
};

export const runTwitterByoConnector = async (
  env: NodeJS.ProcessEnv = process.env,
  loadEvents: (apiKey: string) => Promise<RawEventInput[]> = defaultTwitterLoader
): Promise<ByoConnectorResult> => {
  const guard = evaluateByoGuard({
    connector: 'twitter_byo',
    ...(env.X_BEARER_TOKEN !== undefined && { apiKey: env.X_BEARER_TOKEN }),
    ...(env.X_DAILY_BUDGET_USD !== undefined && { budgetValue: env.X_DAILY_BUDGET_USD }),
    fallbackBudget: 0
  });

  if (!guard.allowed) {
    return {
      status: 'skipped',
      reason: guard.reason,
      events: [],
      telemetry: guard.telemetry
    };
  }

  const events = await loadEvents(env.X_BEARER_TOKEN as string);

  return {
    status: 'active',
    events,
    telemetry: {
      connector: 'twitter_byo',
      skipped: false,
      budget_usd: guard.budgetUsd
    }
  };
};
