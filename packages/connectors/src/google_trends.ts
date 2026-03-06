import { type RawEventInput, withRetry } from './common/http';

type GoogleTrendsLoaderFn = (limit: number) => Promise<string>;

const TRENDS_RSS_URL = 'https://trends.google.com/trending/rss?geo=US';

const defaultLoader: GoogleTrendsLoaderFn = async () => {
  return withRetry(async () => {
    const res = await fetch(TRENDS_RSS_URL, {
      headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' }
    });
    if (!res.ok) throw new Error(`Google Trends RSS failed: ${res.status}`);
    return res.text();
  });
};

export const fetchGoogleTrends = async (
  loadRss: GoogleTrendsLoaderFn = defaultLoader,
  limit = 30
): Promise<RawEventInput[]> => {
  const xml = await loadRss(limit);
  const results: RawEventInput[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null = itemRegex.exec(xml);

  while (match !== null && results.length < limit) {
    const item = match[1];
    const title = item.match(/<title><!\[CDATA\[(.*?)\]\]>/)?.[1]
      ?? item.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] ?? '';
    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? '';
    const description = item.match(/<description><!\[CDATA\[(.*?)\]\]>/)?.[1]
      ?? item.match(/<description>(.*?)<\/description>/)?.[1] ?? '';

    if (title) {
      results.push({
        source: 'google_trends',
        source_item_id: `gtrends:${title.toLowerCase().replace(/\s+/g, '-').slice(0, 100)}`,
        source_timestamp: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        text: description ? `${title}: ${description}` : title,
        url: link || `https://trends.google.com/trending?q=${encodeURIComponent(title)}`,
      });
    }
    match = itemRegex.exec(xml);
  }

  return results.slice(0, limit);
};
