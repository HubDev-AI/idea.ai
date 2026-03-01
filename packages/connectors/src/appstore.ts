import { fetchJsonWithRetry, type RawEventInput } from './common/http';

type ItunesEntry = {
  'im:name': { label: string };
  id: { attributes: { 'im:id': string } };
  summary: { label: string };
  link: { attributes: { href: string } }[];
  'im:releaseDate': { label: string };
  category: { attributes: { label: string } };
};

type ItunesFeed = {
  feed: { entry?: ItunesEntry[] };
};

const ITUNES_CATEGORIES = ['social-networking', 'productivity', 'lifestyle', 'entertainment', 'communication'];

export const fetchAppStoreTrending = async (options?: {
  categories?: string[];
  limit?: number;
  fetchImpl?: typeof fetch;
}): Promise<RawEventInput[]> => {
  const categories = options?.categories ?? ITUNES_CATEGORIES;
  const limit = options?.limit ?? 30;
  const results: RawEventInput[] = [];

  for (const category of categories) {
    try {
      const data = await fetchJsonWithRetry<ItunesFeed>(
        `https://itunes.apple.com/us/rss/topfreeapplications/limit=10/genre=${category}/json`,
        { ...(options?.fetchImpl !== undefined && { fetchImpl: options.fetchImpl }) }
      );

      for (const entry of data.feed.entry ?? []) {
        results.push({
          source: 'appstore_trending',
          source_item_id: `appstore:${entry.id.attributes['im:id']}`,
          source_timestamp: entry['im:releaseDate']?.label ?? new Date().toISOString(),
          text: `${entry['im:name'].label}\n${entry.summary.label}`.slice(0, 2000),
          url: entry.link?.[0]?.attributes?.href ?? ''
        });
      }
    } catch {
      // Skip failed category, don't crash entire connector
    }
  }

  return results.slice(0, limit);
};
