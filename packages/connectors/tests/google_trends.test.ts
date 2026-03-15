import { describe, expect, it, vi } from 'vitest';
import { fetchGoogleTrends } from '../src/google_trends';

describe('google_trends connector', () => {
  it('parses RSS items into RawEventInput', async () => {
    const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>AI dating app</title>
      <link>https://trends.google.com/trending?q=AI+dating+app</link>
      <pubDate>Wed, 05 Mar 2026 10:00:00 GMT</pubDate>
      <description>AI dating app - 200,000+ searches</description>
    </item>
    <item>
      <title>meal prep subscription</title>
      <link>https://trends.google.com/trending?q=meal+prep+subscription</link>
      <pubDate>Wed, 05 Mar 2026 09:00:00 GMT</pubDate>
      <description>meal prep subscription - 100,000+ searches</description>
    </item>
  </channel>
</rss>`;

    const mockLoader = vi.fn().mockResolvedValue(mockRss);
    const results = await fetchGoogleTrends(mockLoader, 10);

    expect(results).toHaveLength(2);
    expect(results[0]!.source).toBe('google_trends');
    expect(results[0]!.text).toContain('AI dating app');
    expect(results[0]!.url).toContain('trends.google.com');
    expect(results[0]!.source_item_id).toMatch(/^gtrends:/);
  });

  it('respects limit parameter', async () => {
    const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item><title>A</title><link>https://a.com</link><pubDate>Wed, 05 Mar 2026 10:00:00 GMT</pubDate><description>A</description></item>
    <item><title>B</title><link>https://b.com</link><pubDate>Wed, 05 Mar 2026 09:00:00 GMT</pubDate><description>B</description></item>
    <item><title>C</title><link>https://c.com</link><pubDate>Wed, 05 Mar 2026 08:00:00 GMT</pubDate><description>C</description></item>
  </channel>
</rss>`;

    const mockLoader = vi.fn().mockResolvedValue(mockRss);
    const results = await fetchGoogleTrends(mockLoader, 2);
    expect(results).toHaveLength(2);
  });

  it('falls back to constructed URL when link is empty', async () => {
    const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>vibe coding</title>
      <link></link>
      <pubDate>Wed, 05 Mar 2026 10:00:00 GMT</pubDate>
      <description>vibe coding - 50,000+ searches</description>
    </item>
  </channel>
</rss>`;

    const mockLoader = vi.fn().mockResolvedValue(mockRss);
    const results = await fetchGoogleTrends(mockLoader, 10);
    expect(results[0]!.url).toContain('vibe%20coding');
  });

  it('uses current timestamp when pubDate is missing', async () => {
    const before = new Date();
    const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>no date topic</title>
      <link>https://trends.google.com/trending?q=no+date</link>
      <description>no date topic - 10,000+ searches</description>
    </item>
  </channel>
</rss>`;

    const mockLoader = vi.fn().mockResolvedValue(mockRss);
    const results = await fetchGoogleTrends(mockLoader, 10);
    const after = new Date();
    const ts = new Date(results[0]!.source_timestamp);
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('slugifies source_item_id correctly', async () => {
    const mockRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>AI Health App</title>
      <link>https://trends.google.com/trending?q=AI+Health+App</link>
      <pubDate>Wed, 05 Mar 2026 10:00:00 GMT</pubDate>
      <description>AI Health App - 75,000+ searches</description>
    </item>
  </channel>
</rss>`;

    const mockLoader = vi.fn().mockResolvedValue(mockRss);
    const results = await fetchGoogleTrends(mockLoader, 10);
    expect(results[0]!.source_item_id).toBe('gtrends:ai-health-app');
  });
});
