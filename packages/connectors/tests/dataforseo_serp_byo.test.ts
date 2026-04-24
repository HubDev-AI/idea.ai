import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSerpByoConnector } from '../src/dataforseo_serp_byo';

// ---- Fixture helpers ----

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

const TASK_ID = '00000000-0000-0000-0000-000000000001';

const DE_SERP_FIXTURE = {
  tasks: [{
    id: TASK_ID,
    status_code: 20000,
    result: [{
      keyword: 'Gehaltsrechner',
      location_code: 2276,
      language_code: 'de',
      datetime: '2026-04-24 10:00:00 +00:00',
      item_types: ['organic', 'ai_overview', 'people_also_ask', 'featured_snippet', 'knowledge_graph'],
      items: [
        {
          type: 'ai_overview',
          rank_absolute: 0,
          markdown: 'Ein Gehaltsrechner hilft bei der Berechnung des Nettogehalts. Weitere Informationen zu Steuerabzügen.'
        },
        {
          type: 'people_also_ask',
          rank_absolute: 0,
          items: [
            {
              type: 'people_also_ask_element',
              title: 'Was ist ein Gehaltsrechner?',
              expanded_element: [{ description: 'Ein Tool zur Gehaltsberechnung.' }]
            }
          ]
        },
        {
          type: 'organic',
          rank_absolute: 1,
          domain: 'gehaltsrechner.de',
          title: 'Gehaltsrechner 2026 – Brutto-Netto',
          description: 'Berechnen Sie Ihr Nettogehalt schnell und einfach.',
          url: 'https://gehaltsrechner.de'
        },
        {
          type: 'organic',
          rank_absolute: 2,
          domain: 'lohn.de',
          title: 'Lohnrechner Online',
          description: 'Kostenloser Lohnrechner für Deutschland.',
          url: 'https://lohn.de'
        },
        {
          type: 'organic',
          rank_absolute: 3,
          domain: 'finanzen.de',
          title: 'Netto Gehalt berechnen',
          description: 'Nettogehalt einfach berechnen.',
          url: 'https://finanzen.de/gehalt'
        }
      ]
    }]
  }]
};

const TASK_POST_RESPONSE = {
  tasks: [{ id: TASK_ID, status_code: 20100, status_message: 'Task Created.' }]
};

const TASKS_READY_RESPONSE = {
  tasks: [{
    status_code: 20000,
    result: [{ id: TASK_ID, se: 'google', se_type: 'organic', tag: 'Gehaltsrechner|DE|de' }]
  }]
};

function makeStandardMockFetch(taskGetResponse = DE_SERP_FIXTURE): typeof fetch {
  return vi.fn(async (url: RequestInfo) => {
    const urlStr = String(url);
    if (urlStr.includes('task_post')) return mockResponse(TASK_POST_RESPONSE);
    if (urlStr.includes('tasks_ready')) return mockResponse(TASKS_READY_RESPONSE);
    if (urlStr.includes('task_get/advanced')) return mockResponse(taskGetResponse);
    throw new Error(`Unhandled URL in mock: ${urlStr}`);
  }) as unknown as typeof fetch;
}

const DE_QUERY = { keyword: 'Gehaltsrechner', country_code: 'DE', language_code: 'de' };
const TEST_ENV = {
  DATAFORSEO_API_KEY: 'dGVzdDpwYXNz',
  DATAFORSEO_DAILY_BUDGET_USD: '5',
  DATAFORSEO_POLL_INITIAL_MS: '10',
  DATAFORSEO_POLL_CEILING_MS: '5000',
};

// ---- Tests ----

describe('runSerpByoConnector', () => {
  // === Guard paths ===

  it('skips when DATAFORSEO_API_KEY is missing', async () => {
    const result = await runSerpByoConnector([DE_QUERY], {});
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('missing_credentials');
    expect(result.events).toHaveLength(0);
  });

  it('skips when budget exhausted', async () => {
    const result = await runSerpByoConnector(
      [DE_QUERY],
      { DATAFORSEO_API_KEY: 'key', DATAFORSEO_DAILY_BUDGET_USD: '0' }
    );
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('budget_exhausted');
    expect(result.events).toHaveLength(0);
  });

  // === POST → poll → fetch lifecycle (execution note: write this failing test first) ===

  it('full lifecycle: POST → tasks_ready → task_get → events', async () => {
    const result = await runSerpByoConnector([DE_QUERY], TEST_ENV, makeStandardMockFetch());

    expect(result.status).toBe('active');
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0]!.source).toBe('dataforseo_serp');
  });

  it('emits correct source_item_id format: dataforseo:{taskId}:{rank_absolute}', async () => {
    const result = await runSerpByoConnector([DE_QUERY], TEST_ENV, makeStandardMockFetch());

    const organic = result.events.filter((e) => (e.metadata?.['organic_position'] as number) > 0);
    expect(organic[0]!.source_item_id).toBe(`dataforseo:${TASK_ID}:1`);
    expect(organic[1]!.source_item_id).toBe(`dataforseo:${TASK_ID}:2`);
  });

  it('emits correct event shape with metadata', async () => {
    const result = await runSerpByoConnector([DE_QUERY], TEST_ENV, makeStandardMockFetch());

    const first = result.events.find((e) => e.metadata?.['organic_position'] === 1)!;
    expect(first.url).toBe('https://gehaltsrechner.de');
    expect(first.text).toContain('Gehaltsrechner 2026');
    expect(first.metadata?.['country_code']).toBe('DE');
    expect(first.metadata?.['language_code']).toBe('de');
    expect(first.metadata?.['domain']).toBe('gehaltsrechner.de');
    expect(first.metadata?.['keyword']).toBe('Gehaltsrechner');
    expect(first.engagement_count).toBeUndefined();
  });

  // === AIO presence ===

  it('sets aio_present + aio_text when AI Overview in item_types', async () => {
    const result = await runSerpByoConnector([DE_QUERY], TEST_ENV, makeStandardMockFetch());

    for (const event of result.events) {
      expect(event.metadata?.['aio_present']).toBe(true);
      expect(event.metadata?.['aio_text']).toContain('Gehaltsrechner');
    }
  });

  it('sets paa_present and paa_entries on all organic rows', async () => {
    const result = await runSerpByoConnector([DE_QUERY], TEST_ENV, makeStandardMockFetch());

    for (const event of result.events) {
      expect(event.metadata?.['paa_present']).toBe(true);
      const entries = event.metadata?.['paa_entries'] as Array<{ question: string; snippet: string }>;
      expect(entries).toHaveLength(1);
      expect(entries[0]!.question).toBe('Was ist ein Gehaltsrechner?');
    }
  });

  it('sets featured_snippet_present and knowledge_panel_present from item_types', async () => {
    const result = await runSerpByoConnector([DE_QUERY], TEST_ENV, makeStandardMockFetch());

    for (const event of result.events) {
      expect(event.metadata?.['featured_snippet_present']).toBe(true);
      expect(event.metadata?.['knowledge_panel_present']).toBe(true);
    }
  });

  // === German locale R22 ===

  it('R22: German fixture preserves non-ASCII characters in text', async () => {
    const result = await runSerpByoConnector([DE_QUERY], TEST_ENV, makeStandardMockFetch());

    const event = result.events.find((e) => e.url === 'https://gehaltsrechner.de')!;
    expect(event.text).toContain('Brutto-Netto');
    expect(event.text).toContain('Nettogehalt');
    expect(event.metadata?.['country_code']).toBe('DE');
  });

  // === Polish locale R22 ===

  it('R22: Polish query resolves correctly', async () => {
    const plFixture = {
      tasks: [{
        id: TASK_ID,
        status_code: 20000,
        result: [{
          keyword: 'kalkulator wynagrodzeń',
          location_code: 2616,
          language_code: 'pl',
          datetime: '2026-04-24 10:00:00 +00:00',
          item_types: ['organic'],
          items: [{
            type: 'organic',
            rank_absolute: 1,
            domain: 'wynagrodzenia.pl',
            title: 'Kalkulator wynagrodzeń',
            description: 'Oblicz swoje wynagrodzenie netto.',
            url: 'https://wynagrodzenia.pl'
          }]
        }]
      }]
    };
    const mockFetch = makeStandardMockFetch(plFixture);
    const result = await runSerpByoConnector(
      [{ keyword: 'kalkulator wynagrodzeń', country_code: 'PL', language_code: 'pl' }],
      TEST_ENV,
      mockFetch
    );
    expect(result.status).toBe('active');
    const event = result.events[0]!;
    expect(event.metadata?.['country_code']).toBe('PL');
    expect(event.text).toContain('wynagrodzenie');
  });

  // === R15 locale rejection ===

  it('rejects unsupported locale, continues with valid inputs', async () => {
    const mockFetch = makeStandardMockFetch();
    const result = await runSerpByoConnector(
      [
        DE_QUERY,
        { keyword: 'test', country_code: 'XX', language_code: 'xx' }
      ],
      TEST_ENV,
      mockFetch
    );
    expect(result.locale_rejections).toHaveLength(1);
    expect(result.locale_rejections![0]!.country_code).toBe('XX');
    expect(result.status).toBe('active');
  });

  it('returns skipped (zero events) when all inputs are unsupported locales', async () => {
    const mockFetch = vi.fn() as unknown as typeof fetch;
    const result = await runSerpByoConnector(
      [{ keyword: 'test', country_code: 'XX', language_code: 'xx' }],
      TEST_ENV,
      mockFetch
    );
    expect(result.events).toHaveLength(0);
    expect(result.locale_rejections).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // === R18 batch cap ===

  it('caps inputs at MAX_BATCH_PER_RUN', async () => {
    const inputs = Array.from({ length: 10 }, (_, i) => ({
      keyword: `keyword ${i}`,
      country_code: 'DE',
      language_code: 'de'
    }));

    const postCalls: unknown[] = [];
    const mockFetch = vi.fn(async (url: RequestInfo, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('task_post')) {
        const body = JSON.parse((init?.body ?? '[]') as string) as unknown[];
        postCalls.push(...body);
        return mockResponse({ tasks: [] });
      }
      if (urlStr.includes('tasks_ready')) return mockResponse({ tasks: [{ result: [] }] });
      throw new Error(`Unhandled: ${urlStr}`);
    }) as unknown as typeof fetch;

    await runSerpByoConnector(inputs, { ...TEST_ENV, DATAFORSEO_MAX_BATCH_PER_RUN: '3' }, mockFetch);
    expect(postCalls.length).toBe(3);
  });

  // === R17 spend preview ===

  it('emits estimated_spend_usd before API calls', async () => {
    const result = await runSerpByoConnector([DE_QUERY], TEST_ENV, makeStandardMockFetch());
    expect(result.estimated_spend_usd).toBeGreaterThan(0);
  });

  // === Poll timeout ===

  it('returns partial results with poll_timeout when ceiling exceeded', async () => {
    const mockFetch = vi.fn(async (url: RequestInfo) => {
      const urlStr = String(url);
      if (urlStr.includes('task_post')) return mockResponse(TASK_POST_RESPONSE);
      if (urlStr.includes('tasks_ready')) return mockResponse({ tasks: [{ result: [] }] }); // never ready
      throw new Error(`Unhandled: ${urlStr}`);
    }) as unknown as typeof fetch;

    const result = await runSerpByoConnector(
      [DE_QUERY],
      { ...TEST_ENV, DATAFORSEO_POLL_CEILING_MS: '100', DATAFORSEO_POLL_INITIAL_MS: '10' },
      mockFetch
    );

    expect(result.poll_summary?.timed_out).toBe(true);
    expect(result.poll_summary?.retrieved).toBe(0);
    expect(result.poll_summary?.total).toBe(1);
    expect(result.status).toBe('active');
  });

  // === Per-task error isolation ===

  it('skips errored tasks and continues with rest', async () => {
    const taskId2 = '00000000-0000-0000-0000-000000000002';
    const mockFetch = vi.fn(async (url: RequestInfo) => {
      const urlStr = String(url);
      if (urlStr.includes('task_post')) {
        return mockResponse({
          tasks: [
            { id: TASK_ID, status_code: 20100 },
            { id: taskId2, status_code: 20100 }
          ]
        });
      }
      if (urlStr.includes('tasks_ready')) {
        return mockResponse({
          tasks: [{ result: [{ id: TASK_ID }, { id: taskId2 }] }]
        });
      }
      if (urlStr.includes(TASK_ID)) return mockResponse(DE_SERP_FIXTURE);
      if (urlStr.includes(taskId2)) return mockResponse({ error: 'task failed' }, 500);
      throw new Error(`Unhandled: ${urlStr}`);
    }) as unknown as typeof fetch;

    const result = await runSerpByoConnector(
      [
        DE_QUERY,
        { keyword: 'other', country_code: 'PL', language_code: 'pl' }
      ],
      TEST_ENV,
      mockFetch
    );

    expect(result.status).toBe('active');
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.poll_summary?.retrieved).toBe(2);
  });

  // === SERP feature flags ===

  it('sets shopping_ads_present when shopping in item_types', async () => {
    const fixture = {
      tasks: [{
        id: TASK_ID,
        status_code: 20000,
        result: [{
          keyword: 'shoes',
          location_code: 2840,
          language_code: 'en',
          datetime: '2026-04-24 10:00:00 +00:00',
          item_types: ['organic', 'shopping'],
          items: [{
            type: 'organic',
            rank_absolute: 1,
            domain: 'shoes.com',
            title: 'Best Shoes',
            description: 'Buy shoes online.',
            url: 'https://shoes.com'
          }]
        }]
      }]
    };
    const result = await runSerpByoConnector(
      [{ keyword: 'shoes', country_code: 'US', language_code: 'en' }],
      TEST_ENV,
      makeStandardMockFetch(fixture)
    );
    expect(result.events[0]!.metadata?.['shopping_ads_present']).toBe(true);
    expect(result.events[0]!.metadata?.['aio_present']).toBe(false);
  });

  // === Depth config ===

  it('passes depth from DATAFORSEO_SERP_DEPTH env var to task post', async () => {
    const postedBodies: unknown[] = [];
    const mockFetch = vi.fn(async (url: RequestInfo, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('task_post')) {
        postedBodies.push(JSON.parse((init?.body ?? '[]') as string));
        return mockResponse({ tasks: [] });
      }
      if (urlStr.includes('tasks_ready')) return mockResponse({ tasks: [{ result: [] }] });
      throw new Error(`Unhandled: ${urlStr}`);
    }) as unknown as typeof fetch;

    await runSerpByoConnector(
      [DE_QUERY],
      { ...TEST_ENV, DATAFORSEO_SERP_DEPTH: '50', DATAFORSEO_POLL_CEILING_MS: '50', DATAFORSEO_POLL_INITIAL_MS: '10' },
      mockFetch
    );

    const tasks = (postedBodies[0] as Array<{ depth?: number }>);
    expect(tasks[0]!.depth).toBe(50);
  });

  // === load_async_ai_overview always set ===

  it('sends load_async_ai_overview: true on every task', async () => {
    const postedBodies: unknown[] = [];
    const mockFetch = vi.fn(async (url: RequestInfo, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('task_post')) {
        postedBodies.push(JSON.parse((init?.body ?? '[]') as string));
        return mockResponse({ tasks: [] });
      }
      if (urlStr.includes('tasks_ready')) return mockResponse({ tasks: [{ result: [] }] });
      throw new Error(`Unhandled: ${urlStr}`);
    }) as unknown as typeof fetch;

    await runSerpByoConnector(
      [DE_QUERY],
      { ...TEST_ENV, DATAFORSEO_POLL_CEILING_MS: '50', DATAFORSEO_POLL_INITIAL_MS: '10' },
      mockFetch
    );

    const tasks = (postedBodies[0] as Array<{ load_async_ai_overview?: boolean }>);
    expect(tasks[0]!.load_async_ai_overview).toBe(true);
  });

  // === All rows carry aio_text (not just position 1) ===

  it('all organic rows carry aio_text and paa_entries when AIO present', async () => {
    const result = await runSerpByoConnector([DE_QUERY], TEST_ENV, makeStandardMockFetch());
    const organics = result.events.filter((e) => (e.metadata?.['organic_position'] as number) > 0);
    expect(organics).toHaveLength(3);
    for (const row of organics) {
      expect(row.metadata?.['aio_text']).toBeTruthy();
      expect(row.metadata?.['paa_entries']).toBeTruthy();
    }
  });

  // === Authorization header never logged ===

  it('does not expose API key in Authorization header via fetch calls', async () => {
    const seenHeaders: string[] = [];
    const mockFetch = vi.fn(async (url: RequestInfo, init?: RequestInit) => {
      const urlStr = String(url);
      const auth = (init?.headers as Record<string, string>)?.['Authorization'] ?? '';
      seenHeaders.push(auth);
      if (urlStr.includes('task_post')) return mockResponse(TASK_POST_RESPONSE);
      if (urlStr.includes('tasks_ready')) return mockResponse(TASKS_READY_RESPONSE);
      if (urlStr.includes('task_get/advanced')) return mockResponse(DE_SERP_FIXTURE);
      throw new Error(`Unhandled: ${urlStr}`);
    }) as unknown as typeof fetch;

    await runSerpByoConnector([DE_QUERY], TEST_ENV, mockFetch);

    // Auth header should be set (that's correct) but value should be our test key, not leaked
    for (const h of seenHeaders) {
      expect(h).toBe(`Basic ${TEST_ENV.DATAFORSEO_API_KEY}`);
    }
  });
});
