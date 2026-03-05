import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput, withRetry } from './common/http';

type HnItem = {
  objectID: string;
  created_at_i: number;
  title?: string;
  url?: string;
  points?: number;
  num_comments?: number;
};

type HnLoader = (limit: number) => Promise<HnItem[]>;

const defaultHnLoader: HnLoader = async (limit) => {
  const response = await fetchJsonWithRetry<{ hits?: HnItem[] }>(
    `https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=${limit}`
  );

  return response.hits ?? [];
};

export const fetchHnEvents = async (
  loadItems: HnLoader = defaultHnLoader,
  limit = OPEN_CONNECTOR_LIMITS.hn
): Promise<RawEventInput[]> => {
  const items = await withRetry(() => loadItems(limit));

  return items
    .slice(0, limit)
    .filter((item) => typeof item.objectID === 'string' && item.objectID.length > 0)
    .map((item) => {
      const timestampMs =
        typeof item.created_at_i === 'number' && Number.isFinite(item.created_at_i)
          ? item.created_at_i * 1000
          : Date.now();

      return {
        source: 'hacker_news',
        source_item_id: item.objectID,
        source_timestamp: new Date(timestampMs).toISOString(),
        text: (item.title ?? '').trim(),
        url: item.url ?? `https://news.ycombinator.com/item?id=${item.objectID}`,
        engagement_count: (item.points ?? 0) + (item.num_comments ?? 0)
      };
    })
    .filter((item) => item.text.length > 0);
};
