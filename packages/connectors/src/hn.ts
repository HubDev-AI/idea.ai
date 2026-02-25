import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput, withRetry } from './common/http';

type HnItem = {
  id: number;
  time: number;
  title?: string;
  text?: string;
  url?: string;
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
    .filter((item) => Number.isFinite(item.id))
    .map((item) => {
      const timestampMs =
        typeof item.time === 'number' && Number.isFinite(item.time) ? item.time * 1000 : Date.now();

      return {
        source: 'hacker_news',
        source_item_id: String(item.id),
        source_timestamp: new Date(timestampMs).toISOString(),
        text: `${item.title ?? ''}\n${item.text ?? ''}`.trim(),
        url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`
      };
    })
    .filter((item) => item.text.length > 0);
};
