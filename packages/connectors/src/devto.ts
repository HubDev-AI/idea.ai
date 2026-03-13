import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput } from './common/http';

type DevtoArticle = {
  id: number;
  title: string;
  description: string;
  url: string;
  published_at: string;
  public_reactions_count: number;
  comments_count: number;
  tag_list: string[];
};

type DevtoLoaderFn = () => Promise<DevtoArticle[]>;

const TAGS = ['devtools', 'cli', 'productivity', 'opensource', 'sideproject'];

const defaultLoader: DevtoLoaderFn = async () => {
  const allArticles: DevtoArticle[] = [];

  for (const tag of TAGS) {
    try {
      const articles = await fetchJsonWithRetry<DevtoArticle[]>(
        `https://dev.to/api/articles?tag=${tag}&top=7&per_page=10`,
        { init: { headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' } } }
      );
      allArticles.push(...articles);
    } catch {
      // Skip failed tag, continue with others
    }
  }

  // Deduplicate by id
  const seen = new Set<number>();
  return allArticles.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
};

export const fetchDevtoEvents = async (
  loadItems: DevtoLoaderFn = defaultLoader,
  limit: number = OPEN_CONNECTOR_LIMITS.devto
): Promise<RawEventInput[]> => {
  const items = await loadItems();

  return items
    .slice(0, limit)
    .filter((item) => item.id && item.title)
    .map((item) => ({
      source: 'devto',
      source_item_id: `devto:${item.id}`,
      source_timestamp: item.published_at || new Date().toISOString(),
      text: item.description ? `${item.title}: ${item.description}` : item.title,
      url: item.url,
      engagement_count: (item.public_reactions_count ?? 0) + (item.comments_count ?? 0)
    }));
};
