import { describe, it, expect } from 'vitest';
import { fetchAlternativeTo } from '../src/alternativeto';

describe('alternativeto connector', () => {
  it('parses RSS items into RawEventInput', async () => {
    const mockRss = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>10 Best Alternatives to Notion in 2026</title>
      <link>https://alternativeto.net/software/notion/</link>
      <pubDate>Wed, 05 Mar 2026 10:00:00 GMT</pubDate>
      <description>Users are looking for alternatives to Notion for note-taking and project management.</description>
    </item>
    <item>
      <title>5 Best Alternatives to Figma</title>
      <link>https://alternativeto.net/software/figma/</link>
      <pubDate>Wed, 05 Mar 2026 09:00:00 GMT</pubDate>
      <description>Looking for Figma alternatives with better collaboration features.</description>
    </item>
  </channel>
</rss>`;

    const mockLoader = async () => mockRss;
    const results = await fetchAlternativeTo(mockLoader, 10);

    expect(results).toHaveLength(2);
    expect(results[0].source).toBe('alternativeto');
    expect(results[0].text).toContain('Notion');
    expect(results[0].url).toContain('alternativeto.net');
    expect(results[0].source_item_id).toMatch(/^altto:/);
  });

  it('respects limit parameter', async () => {
    const mockRss = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item><title>A</title><link>https://alternativeto.net/software/a/</link><pubDate>Wed, 05 Mar 2026 10:00:00 GMT</pubDate><description>A desc</description></item>
    <item><title>B</title><link>https://alternativeto.net/software/b/</link><pubDate>Wed, 05 Mar 2026 09:00:00 GMT</pubDate><description>B desc</description></item>
    <item><title>C</title><link>https://alternativeto.net/software/c/</link><pubDate>Wed, 05 Mar 2026 08:00:00 GMT</pubDate><description>C desc</description></item>
  </channel>
</rss>`;

    const mockLoader = async () => mockRss;
    const results = await fetchAlternativeTo(mockLoader, 2);
    expect(results).toHaveLength(2);
  });
});
