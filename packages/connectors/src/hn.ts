import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput, withRetry } from './common/http';

type HnItem = {
  id: number;
  time: number;
  title?: string;
  text?: string;
  url?: string;
};

type HnLoader = (limit: number) => Promise<HnItem[]>;

const defaultHnLoader: HnLoader = (limit) =>
  fetchJsonWithRetry<HnItem[]>(`https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=${limit}`);

export const fetchHnEvents = async (
  loadItems: HnLoader = defaultHnLoader,
  limit = OPEN_CONNECTOR_LIMITS.hn
): Promise<RawEventInput[]> => {
  const items = await withRetry(() => loadItems(limit));

  return items.slice(0, limit).map((item) => ({
    source: 'hacker_news',
    source_item_id: String(item.id),
    source_timestamp: new Date(item.time * 1000).toISOString(),
    text: `${item.title ?? ''}\n${item.text ?? ''}`.trim(),
    url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`
  }));
};
