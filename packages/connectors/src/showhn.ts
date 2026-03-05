import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput } from './common/http';

type ShowHnHit = {
  objectID: string;
  created_at_i: number;
  title?: string;
  url?: string;
  points: number;
  num_comments: number;
  story_text?: string;
};

type ShowHnLoaderFn = (limit: number) => Promise<ShowHnHit[]>;

const defaultLoader: ShowHnLoaderFn = async (limit) => {
  const response = await fetchJsonWithRetry<{ hits?: ShowHnHit[] }>(
    `https://hn.algolia.com/api/v1/search?tags=show_hn&numericFilters=points%3E15&hitsPerPage=${limit}`
  );
  return response.hits ?? [];
};

export const fetchShowHnEvents = async (
  loadItems: ShowHnLoaderFn = defaultLoader,
  limit = OPEN_CONNECTOR_LIMITS.showhn
): Promise<RawEventInput[]> => {
  const items = await loadItems(limit);

  return items
    .slice(0, limit)
    .filter((item) => typeof item.objectID === 'string' && item.objectID.length > 0)
    .map((item) => {
      const timestampMs =
        typeof item.created_at_i === 'number' && Number.isFinite(item.created_at_i)
          ? item.created_at_i * 1000
          : Date.now();

      return {
        source: 'showhn',
        source_item_id: `showhn:${item.objectID}`,
        source_timestamp: new Date(timestampMs).toISOString(),
        text: (item.title ?? '').trim(),
        url: item.url ?? `https://news.ycombinator.com/item?id=${item.objectID}`
      };
    })
    .filter((item) => item.text.length > 0);
};
