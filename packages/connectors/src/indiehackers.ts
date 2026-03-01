import { type RawEventInput, withRetry } from './common/http';

type IndieHackersLoaderFn = (limit: number) => Promise<RawEventInput[]>;

const defaultLoader: IndieHackersLoaderFn = async (limit) => {
  const response = await withRetry(async () => {
    const res = await fetch('https://www.indiehackers.com/feed.xml', {
      headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' }
    });
    if (!res.ok) throw new Error(`IndieHackers feed failed: ${res.status}`);
    return res.text();
  });

  const results: RawEventInput[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(response)) !== null && results.length < limit) {
    const item = match[1];
    const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ?? item.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] ?? '';
    const description = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1] ?? item.match(/<description>(.*?)<\/description>/)?.[1] ?? '';
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? '';

    if (title) {
      results.push({
        source: 'indiehackers',
        source_item_id: `ih:${link || title}`,
        source_timestamp: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        text: `${title}\n${description.replace(/<[^>]*>/g, '')}`.slice(0, 2000),
        url: link
      });
    }
  }

  return results;
};

export const fetchIndieHackersEvents = async (
  loadEvents: IndieHackersLoaderFn = defaultLoader,
  limit = 20
): Promise<RawEventInput[]> => {
  const events = await loadEvents(limit);
  return events.slice(0, limit);
};
