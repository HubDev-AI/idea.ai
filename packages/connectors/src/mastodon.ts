import { fetchJsonWithRetry, OPEN_CONNECTOR_LIMITS, type RawEventInput } from './common/http';

type MastodonStatus = {
  id: string;
  created_at: string;
  content: string;
  url: string;
  reblogs_count: number;
  favourites_count: number;
  replies_count: number;
  account: { acct: string };
};

type MastodonLoaderFn = () => Promise<MastodonStatus[]>;

const INSTANCES = ['https://fosstodon.org', 'https://hachyderm.io'];
const TAGS = ['devtools', 'buildinpublic', 'opensource', 'cli', 'programming'];

const stripHtml = (html: string): string =>
  html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const defaultLoader: MastodonLoaderFn = async () => {
  const allStatuses: MastodonStatus[] = [];

  for (const instance of INSTANCES) {
    for (const tag of TAGS) {
      try {
        const statuses = await fetchJsonWithRetry<MastodonStatus[]>(
          `${instance}/api/v1/timelines/tag/${tag}?limit=10`,
          { init: { headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' } } }
        );
        allStatuses.push(...statuses);
      } catch {
        // Skip failed instance/tag combo
      }
    }
  }

  // Deduplicate by id
  const seen = new Set<string>();
  return allStatuses.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
};

export const fetchMastodonEvents = async (
  loadItems: MastodonLoaderFn = defaultLoader,
  limit = OPEN_CONNECTOR_LIMITS.mastodon
): Promise<RawEventInput[]> => {
  const items = await loadItems();

  return items
    .slice(0, limit)
    .filter((item) => item.id && item.content)
    .map((item) => ({
      source: 'mastodon',
      source_item_id: `mastodon:${item.id}`,
      source_timestamp: item.created_at || new Date().toISOString(),
      text: stripHtml(item.content).slice(0, 2000),
      url: item.url
    }))
    .filter((item) => item.text.length > 10);
};
