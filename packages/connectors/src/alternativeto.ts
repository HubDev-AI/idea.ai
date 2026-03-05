import { type RawEventInput, withRetry } from './common/http';

type AlternativeToLoaderFn = (limit: number) => Promise<string>;

const ALTTO_RSS_URL = 'https://alternativeto.net/platform/online/feed/';

const defaultLoader: AlternativeToLoaderFn = async () => {
  return withRetry(async () => {
    const res = await fetch(ALTTO_RSS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      }
    });
    if (!res.ok) throw new Error(`AlternativeTo RSS failed: ${res.status}`);
    return res.text();
  });
};

export const fetchAlternativeTo = async (
  loadRss: AlternativeToLoaderFn = defaultLoader,
  limit = 30
): Promise<RawEventInput[]> => {
  const xml = await loadRss(limit);
  const results: RawEventInput[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null && results.length < limit) {
    const item = match[1];
    const title = item.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1]
      ?? item.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] ?? '';
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? '';
    const description = item.match(/<description><!\[CDATA\[(.*?)\]\]>/)?.[1]
      ?? item.match(/<description>(.*?)<\/description>/)?.[1] ?? '';

    if (title) {
      const slug = link.match(/software\/([^/]+)/)?.[1] ?? title.toLowerCase().replace(/\s+/g, '-').slice(0, 80);
      results.push({
        source: 'alternativeto',
        source_item_id: `altto:${slug}`,
        source_timestamp: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        text: description ? `${title}: ${description}` : title,
        url: link || 'https://alternativeto.net/',
      });
    }
  }

  return results.slice(0, limit);
};
