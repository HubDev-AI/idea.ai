import { type RawEventInput, withRetry } from './common/http';

const ENTITIES: Record<string, string> = {
  '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&#x27;': "'", '&#x2F;': '/',
};

const decodeEntities = (text: string): string =>
  text.replace(/&(?:#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match) => {
    if (ENTITIES[match]) return ENTITIES[match];
    if (match.startsWith('&#x')) return String.fromCharCode(parseInt(match.slice(3, -1), 16));
    if (match.startsWith('&#')) return String.fromCharCode(parseInt(match.slice(2, -1), 10));
    return match;
  });

type ProductHuntLoaderFn = (limit: number) => Promise<RawEventInput[]>;

const defaultLoader: ProductHuntLoaderFn = async (limit) => {
  const response = await withRetry(async () => {
    const res = await fetch('https://www.producthunt.com/feed', {
      headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' }
    });
    if (!res.ok) throw new Error(`ProductHunt feed failed: ${res.status}`);
    return res.text();
  });

  const results: RawEventInput[] = [];
  // PH feed is Atom format (<entry> not <item>)
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null = entryRegex.exec(response);

  while (match !== null && results.length < limit) {
    const entry = match[1];
    const title = entry.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
    const link = entry.match(/<link[^>]+href="([^"]+)"/)?.[1] ?? '';
    const content = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? '';
    const published = entry.match(/<published>(.*?)<\/published>/)?.[1] ?? '';

    if (title) {
      const cleanContent = decodeEntities(content)
        .replace(/<[^>]*>/g, '').trim();

      results.push({
        source: 'producthunt',
        source_item_id: `ph:${link || title}`,
        source_timestamp: published ? new Date(published).toISOString() : new Date().toISOString(),
        text: `${title}: ${cleanContent}`.slice(0, 2000),
        url: link
      });
    }
    match = entryRegex.exec(response);
  }

  return results;
};

export const fetchProductHunt = async (
  loadEvents: ProductHuntLoaderFn = defaultLoader,
  limit = 20
): Promise<RawEventInput[]> => {
  const events = await loadEvents(limit);
  return events.slice(0, limit);
};
