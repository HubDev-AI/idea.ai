import { OPEN_CONNECTOR_LIMITS, type RawEventInput, withRetry } from './common/http';

type IndieHackersLoaderFn = (limit: number) => Promise<RawEventInput[]>;

const linkPattern = /<a\s+href="(\/(post|product)\/[^"]+)"[^>]*>\s*<h3[^>]*>([\s\S]*?)<\/h3>/g;

const decodeEntities = (text: string): string =>
  text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/');

const parsePostsFromHtml = (html: string, limit: number): RawEventInput[] => {
  const seen = new Set<string>();
  const results: RawEventInput[] = [];

  linkPattern.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html)) !== null && results.length < limit) {
    const path = match[1];
    const title = decodeEntities(match[3].replace(/<[^>]*>/g, '').trim());

    if (!title || title.length < 5 || seen.has(path)) continue;
    seen.add(path);

    results.push({
      source: 'indiehackers',
      source_item_id: `ih:${path}`,
      source_timestamp: new Date().toISOString(),
      text: title,
      url: `https://www.indiehackers.com${path}`
    });
  }

  return results;
};

const defaultLoader: IndieHackersLoaderFn = async (limit) => {
  const html = await withRetry(async () => {
    const res = await fetch('https://www.indiehackers.com', {
      headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' }
    });
    if (!res.ok) throw new Error(`IndieHackers fetch failed: ${res.status}`);
    return res.text();
  });

  return parsePostsFromHtml(html, limit);
};

export const fetchIndieHackersEvents = async (
  loadEvents: IndieHackersLoaderFn = defaultLoader,
  limit = OPEN_CONNECTOR_LIMITS.indiehackers
): Promise<RawEventInput[]> => {
  const events = await loadEvents(limit);
  return events.slice(0, limit);
};
