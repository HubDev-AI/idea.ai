export type RawEventInput = {
  source: string;
  source_item_id: string;
  source_timestamp: string;
  text: string;
  url: string;
  engagement_count?: number;
};

export type Cadence = 'hourly' | 'daily';

export const OPEN_CONNECTOR_LIMITS = {
  hn: 25,
  github_issues: 25,
  greenhouse: 50,
  lever: 50,
  yc_companies: 50,
  reddit: 25,
  producthunt: 20,
  appstore_trending: 30,
  indiehackers: 20,
  lobsters: 25,
  devto: 30,
  showhn: 25,
  mastodon: 30,
  bluesky: 30,
  homebrew: 50,
  google_trends: 30,
  tiktok_creative: 30,
  alternativeto: 30,
  stackoverflow: 25,
  g2_reviews: 30
} as const;

export const OPEN_CONNECTOR_CADENCE: Record<string, Cadence> = {
  hn: 'hourly',
  github_issues: 'hourly',
  greenhouse: 'daily',
  lever: 'daily',
  yc_companies: 'daily',
  reddit: 'daily',
  producthunt: 'daily',
  appstore_trending: 'daily',
  indiehackers: 'daily',
  lobsters: 'daily',
  devto: 'daily',
  showhn: 'hourly',
  mastodon: 'daily',
  bluesky: 'daily',
  homebrew: 'daily',
  google_trends: 'daily',
  tiktok_creative: 'daily',
  alternativeto: 'daily',
  stackoverflow: 'daily',
  g2_reviews: 'daily'
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

export const withRetry = async <T>(
  run: () => Promise<T>,
  retries = 2,
  baseBackoffMs = 50
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;

      if (attempt === retries) {
        throw error;
      }

      await sleep(baseBackoffMs * (attempt + 1));
    }
  }

  throw lastError;
};

export const fetchJsonWithRetry = async <T>(
  url: string,
  options: {
    retries?: number;
    backoffMs?: number;
    init?: RequestInit;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<T> => {
  const fetchImpl = options.fetchImpl ?? fetch;

  return withRetry(async () => {
    const response = await fetchImpl(url, options.init);

    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for ${url}`);
    }

    return (await response.json()) as T;
  }, options.retries ?? 2, options.backoffMs ?? 50);
};
