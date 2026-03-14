import { describe, expect, it } from 'vitest';
import { fetchBetaList } from '../src/betalist';

// ─── Sample HTML fixtures ────────────────────────────────────────────────────

const MAIN_PAGE_HTML = `
<html><body>
  <a href="/startups/scalify-ai">Scalify AI</a>
  <a href="/startups/devflow-pro">DevFlow Pro</a>
  <a href="/startups/mindmap-ai">MindMap AI</a>
  <a href="/startups/scalify-ai">Duplicate link</a>
  <a href="/topics/ai-tools">AI Tools topic nav link</a>
</body></html>
`;

const STARTUP_PAGE_HTML = `
<html>
<head><title>Scalify AI - BetaList</title></head>
<body>
  <h1>Scalify AI</h1>
  <p>Short.</p>
  <p>Order your own professional website in under 10 minutes using our AI-powered builder. No coding required and fully customizable for any business type.</p>
  <a href="/topics/ai-tools">AI Tools</a>
  <a href="/topics/saas">SaaS</a>
  <time datetime="2026-03-10T00:00:00.000Z">March 10, 2026</time>
</body>
</html>
`;

const STARTUP_PAGE_NO_TOPICS_HTML = `
<html><body>
  <h1>My Startup</h1>
  <p>A really great product that solves a genuinely important problem for people working in software teams everywhere.</p>
  <time datetime="2026-03-10T00:00:00.000Z">March 10</time>
</body></html>
`;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('betalist connector', () => {
  it('returns events with correct source and id prefix', async () => {
    const events = await fetchBetaList({
      loadMainPage: async () => MAIN_PAGE_HTML,
      loadPage: async () => STARTUP_PAGE_HTML,
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.source).toBe('betalist');
    expect(events[0]!.source_item_id).toMatch(/^bl:/);
    expect(events[0]!.url).toMatch(/betalist\.com\/startups\//);
  });

  it('parses name, description, topics, and date from startup page', async () => {
    const events = await fetchBetaList({
      loadMainPage: async () => '<a href="/startups/scalify-ai">x</a>',
      loadPage: async () => STARTUP_PAGE_HTML,
    });

    const event = events[0]!;
    expect(event.text).toContain('Scalify AI');
    expect(event.text).toContain('AI-powered builder');
    expect(event.text).toContain('Topics: ai tools, saas');
    expect(event.source_timestamp).toBe('2026-03-10T00:00:00.000Z');
    expect(event.source_item_id).toBe('bl:scalify-ai');
  });

  it('deduplicates slugs within a single run', async () => {
    const calls: string[] = [];
    await fetchBetaList({
      loadMainPage: async () => MAIN_PAGE_HTML,
      loadPage: async (slug) => {
        calls.push(slug);
        return STARTUP_PAGE_HTML;
      },
    });

    expect(calls.filter((s) => s === 'scalify-ai')).toHaveLength(1);
  });

  it('returns [] when main page has no startup links', async () => {
    const events = await fetchBetaList({
      loadMainPage: async () => '<html><body><p>Nothing here</p></body></html>',
      loadPage: async () => STARTUP_PAGE_HTML,
    });

    expect(events).toEqual([]);
  });

  it('returns partial results when some individual page fetches fail', async () => {
    const slugs = ['slug-a', 'slug-b', 'slug-c', 'slug-d', 'slug-e'];
    const mainHtml = slugs.map((s) => `<a href="/startups/${s}">${s}</a>`).join('\n');

    const events = await fetchBetaList({
      loadMainPage: async () => mainHtml,
      loadPage: async (slug) => {
        if (slug === 'slug-b' || slug === 'slug-d') throw new Error('network error');
        return STARTUP_PAGE_HTML;
      },
    });

    expect(events).toHaveLength(3);
  });

  it('omits Topics line when no topics are found on the page', async () => {
    const events = await fetchBetaList({
      loadMainPage: async () => '<a href="/startups/my-startup">My Startup</a>',
      loadPage: async () => STARTUP_PAGE_NO_TOPICS_HTML,
    });

    expect(events[0]!.text).not.toContain('Topics:');
  });
});
