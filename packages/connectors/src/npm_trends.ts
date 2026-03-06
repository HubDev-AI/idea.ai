import type { RawEventInput } from './common/http';

const NPM_API = 'https://api.npmjs.org/downloads/point/last-week';

const DEFAULT_CATEGORIES: Record<string, string[]> = {
  'ai-agents': ['langchain', 'llamaindex', '@ai-sdk/core', 'autogen'],
  'vector-db': ['chromadb', '@pinecone-database/pinecone', 'weaviate-client', '@qdrant/js-client-rest'],
  'auth': ['lucia', 'better-auth', '@clerk/clerk-sdk-node', 'auth0'],
  'payments': ['stripe', '@lemonsqueezy/lemonsqueezy.js'],
  'observability': ['@opentelemetry/sdk-node', '@sentry/node', 'pino', 'winston'],
  'database': ['drizzle-orm', 'prisma', '@electric-sql/pglite', 'kysely'],
  'realtime': ['socket.io', 'ws', 'ably', 'pusher'],
  'testing': ['vitest', 'playwright', '@testing-library/react', 'cypress'],
  'ui-frameworks': ['svelte', 'solid-js', 'qwik', 'htmx.org'],
  'edge-compute': ['hono', 'elysia', '@cloudflare/workers-types'],
};

export type NpmTrendsOptions = {
  categories?: Record<string, string[]>;
  fetchImpl?: typeof fetch;
};

export const fetchNpmTrends = async (
  opts: NpmTrendsOptions = {},
): Promise<RawEventInput[]> => {
  const { categories = DEFAULT_CATEGORIES, fetchImpl = fetch } = opts;
  const events: RawEventInput[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const [category, packages] of Object.entries(categories)) {
    const downloads: { pkg: string; count: number }[] = [];

    for (const pkg of packages) {
      try {
        const res = await fetchImpl(`${NPM_API}/${encodeURIComponent(pkg)}`);
        if (!res.ok) continue;
        const data = (await res.json()) as { downloads?: number };
        if (data.downloads != null && data.downloads > 0) {
          downloads.push({ pkg, count: data.downloads });
        }
      } catch {
        // Skip failed fetches for individual packages
      }
    }

    if (downloads.length === 0) continue;

    const totalDownloads = downloads.reduce((sum, d) => sum + d.count, 0);
    const topMovers = downloads
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((d) => `${d.pkg} (${d.count.toLocaleString()})`)
      .join(', ');

    events.push({
      source: 'npm_trends',
      source_item_id: `npm:${category}:${today}`,
      source_timestamp: new Date().toISOString(),
      text: `npm category "${category}" weekly downloads: ${totalDownloads.toLocaleString()}. Top packages: ${topMovers}. This suggests developer adoption trends in ${category} tooling.`,
      url: `https://npmtrends.com/${downloads[0]?.pkg ?? packages[0]}`,
      engagement_count: totalDownloads,
    });
  }

  return events;
};
