import type { RawEventInput } from './common/http.js';

const G2_TRENDING_URL = 'https://www.g2.com/categories';

interface G2Options {
  fetchImpl?: typeof fetch;
  limit?: number;
}

export async function fetchG2Trending(opts: G2Options = {}): Promise<RawEventInput[]> {
  const { fetchImpl = fetch, limit = 30 } = opts;

  try {
    const res = await fetchImpl(G2_TRENDING_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IdeaBot/1.0)' },
    });
    if (!res.ok) return [];

    const html = await res.text();
    const events: RawEventInput[] = [];

    const categoryPattern = /href="\/categories\/([^"]+)"[^>]*>([^<]+)</g;
    let match: RegExpExecArray | null = categoryPattern.exec(html);
    while (match !== null && events.length < limit) {
      const [, slug, name] = match;
      const trimmed = (name ?? '').trim();
      if (trimmed.length >= 3) {
        events.push({
          source: 'g2_reviews',
          source_item_id: `g2-cat-${slug}`,
          source_timestamp: new Date().toISOString(),
          text: `[G2 Category] ${trimmed}: software category on G2 with active reviews and alternatives`,
          url: `https://www.g2.com/categories/${slug}`,
        });
      }
      match = categoryPattern.exec(html);
    }

    return events;
  } catch {
    return [];
  }
}
