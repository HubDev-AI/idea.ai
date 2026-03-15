import { OPEN_CONNECTOR_LIMITS, type RawEventInput, withRetry } from './common/http';

// ─── Types ────────────────────────────────────────────────────────────────────

type MainPageLoaderFn = () => Promise<string>;
type PageLoaderFn = (slug: string) => Promise<string>;

export type BetaListDeps = {
  loadMainPage?: MainPageLoaderFn;
  loadPage?: PageLoaderFn;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const decodeEntities = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');

// Regex declared inside function to avoid module-level stateful g-flag regex
const extractSlugs = (html: string, limit: number): string[] => {
  const pattern = /href="\/startups\/([a-z0-9-]+)"/g;
  const seen = new Set<string>();
  const slugs: string[] = [];
  let match = pattern.exec(html);
  while (match !== null && slugs.length < limit) {
    const slug = match[1] ?? '';
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      slugs.push(slug);
    }
    match = pattern.exec(html);
  }
  return slugs;
};

const parseName = (html: string): string => {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  return decodeEntities((match?.[1] ?? '').replace(/<[^>]*>/g, '').trim());
};

const parseDescription = (html: string): string => {
  const paragraphs: string[] = [];
  const pattern = /<p[^>]*>([\s\S]*?)<\/p>/g;
  let match = pattern.exec(html);
  while (match !== null) {
    const text = decodeEntities((match[1] ?? '').replace(/<[^>]*>/g, '').trim());
    if (text.length >= 50) {
      paragraphs.push(text);
    }
    match = pattern.exec(html);
  }
  return paragraphs.sort((a, b) => b.length - a.length)[0] ?? '';
};

const parseTopics = (html: string): string[] => {
  const seen = new Set<string>();
  const topics: string[] = [];
  const pattern = /href="\/topics\/([a-z0-9-]+)"/g;
  let match = pattern.exec(html);
  while (match !== null) {
    const slug = match[1] ?? '';
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      topics.push(slug.replace(/-/g, ' '));
    }
    match = pattern.exec(html);
  }
  return topics;
};

const parseDate = (html: string): string => {
  const match = html.match(/<time[^>]+datetime="([^"]+)"/);
  if (match?.[1]) {
    const parsed = new Date(match[1]);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
};

const buildText = (name: string, description: string, topics: string[]): string => {
  const base = description ? `${name}: ${description}` : name;
  const parts = topics.length > 0 ? [base, `Topics: ${topics.join(', ')}`] : [base];
  return parts.join('\n').slice(0, 2000);
};

const chunk = <T>(arr: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
};

// ─── Default loaders (real HTTP) ─────────────────────────────────────────────

const defaultMainPageLoader: MainPageLoaderFn = () =>
  withRetry(async () => {
    const res = await fetch('https://betalist.com/', {
      headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' },
    });
    if (!res.ok) throw new Error(`BetaList main page failed: ${res.status}`);
    return res.text();
  });

const defaultPageLoader: PageLoaderFn = (slug) =>
  withRetry(async () => {
    const res = await fetch(`https://betalist.com/startups/${slug}`, {
      headers: { 'User-Agent': 'idea.ai/1.0 (research bot)' },
    });
    if (!res.ok) throw new Error(`BetaList startup page failed (${slug}): ${res.status}`);
    return res.text();
  });

// ─── Public export ────────────────────────────────────────────────────────────

export const fetchBetaList = async (
  deps: BetaListDeps = {},
  limit: number = OPEN_CONNECTOR_LIMITS.betalist,
): Promise<RawEventInput[]> => {
  const loadMainPage = deps.loadMainPage ?? defaultMainPageLoader;
  const loadPage = deps.loadPage ?? defaultPageLoader;

  let mainHtml: string;
  try {
    mainHtml = await loadMainPage();
  } catch {
    return [];
  }

  const slugs = extractSlugs(mainHtml, limit);
  if (slugs.length === 0) return [];

  const results: RawEventInput[] = [];

  for (const batch of chunk(slugs, 5)) {
    await Promise.allSettled(
      batch.map(async (slug) => {
        try {
          const html = await loadPage(slug);
          const name = parseName(html);
          if (!name) return;
          results.push({
            source: 'betalist',
            source_item_id: `bl:${slug}`,
            source_timestamp: parseDate(html),
            text: buildText(name, parseDescription(html), parseTopics(html)),
            url: `https://betalist.com/startups/${slug}`,
          });
        } catch {
          // Skip failed slug — remaining batch continues
        }
      }),
    );
  }

  return results.slice(0, limit);
};
