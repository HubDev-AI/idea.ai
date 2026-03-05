import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput } from './common/http';

type LobstersItem = {
  short_id: string;
  created_at: string;
  title: string;
  url: string;
  score: number;
  comment_count: number;
  tags: string[];
};

type LobstersLoaderFn = () => Promise<LobstersItem[]>;

const defaultLoader: LobstersLoaderFn = async () =>
  fetchJsonWithRetry<LobstersItem[]>('https://lobste.rs/hottest.json', {
    init: { headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' } }
  });

export const fetchLobstersEvents = async (
  loadItems: LobstersLoaderFn = defaultLoader,
  limit = OPEN_CONNECTOR_LIMITS.lobsters
): Promise<RawEventInput[]> => {
  const items = await loadItems();

  return items
    .slice(0, limit)
    .filter((item) => item.short_id && item.title)
    .map((item) => ({
      source: 'lobsters',
      source_item_id: `lobsters:${item.short_id}`,
      source_timestamp: item.created_at || new Date().toISOString(),
      text: item.title,
      url: item.url || `https://lobste.rs/s/${item.short_id}`
    }));
};
