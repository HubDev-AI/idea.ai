import {
  SerpApi,
  SerpGoogleOrganicTaskPostRequestInfo,
  type AiOverviewSerpElementItem,
  type OrganicSerpElementItem,
  type PeopleAlsoAskSerpElementItem,
  type BaseSerpApiElementItem,
} from 'dataforseo-client';

import { evaluateByoGuard, type ByoConnectorResult } from './byo_guard';
import { type RawEventInput } from './common/http';
import { lookupDataForSeoLocale } from './dataforseo_location_helpers';

// ---- Public types ----

export type SerpQuery = {
  keyword: string;
  country_code: string;
  language_code: string;
};

export type SerpConnectorResult = ByoConnectorResult & {
  locale_rejections?: Array<{ country_code: string; language_code: string }>;
  poll_summary?: { total: number; retrieved: number; timed_out: boolean };
  estimated_spend_usd?: number;
};

// ---- Internal types ----

type ValidatedQuery = SerpQuery & { location_code: number; vendor_language_code: string };

// ---- Constants ----

const CHUNK_SIZE = 100;
const DEFAULT_POLL_INITIAL_MS = 30_000;
const DEFAULT_POLL_MAX_MS = 120_000;
const DEFAULT_POLL_CEILING_MS = 10 * 60 * 1000;

// ---- Helpers ----

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function extractAioText(items: BaseSerpApiElementItem[]): string | null {
  const aio = items.find((i) => i.type === 'ai_overview') as AiOverviewSerpElementItem | undefined;
  if (!aio) return null;
  const text = aio.markdown ?? '';
  // Cap at 4 KB — reduces LLM prompt injection surface from attacker-controlled SERP content
  return text.slice(0, 4096) || null;
}

function extractPaaEntries(
  items: BaseSerpApiElementItem[]
): Array<{ question: string; snippet: string }> | null {
  const paa = items.find((i) => i.type === 'people_also_ask') as
    | PeopleAlsoAskSerpElementItem
    | undefined;
  if (!paa?.items) return null;

  const entries = paa.items
    .map((e) => ({
      question: String(e.title ?? ''),
      snippet: String(e.expanded_element?.[0]?.['description'] ?? ''),
    }))
    .filter((e) => e.question);

  return entries.length > 0 ? entries : null;
}

// ---- Connector ----

export const runSerpByoConnector = async (
  inputs: SerpQuery[],
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<SerpConnectorResult> => {
  // 1. Guard — early exit if credentials absent or budget exhausted
  const guard = evaluateByoGuard({
    connector: 'dataforseo_serp_byo',
    ...(env.DATAFORSEO_API_KEY !== undefined && { apiKey: env.DATAFORSEO_API_KEY }),
    ...(env.DATAFORSEO_DAILY_BUDGET_USD !== undefined && { budgetValue: env.DATAFORSEO_DAILY_BUDGET_USD }),
    fallbackBudget: 5,
  });

  if (!guard.allowed) {
    return { status: 'skipped', reason: guard.reason, events: [], telemetry: guard.telemetry };
  }

  // 2. R17 spend preview (informational; no blocking enforcement in v1)
  const depth = Math.max(1, parseInt(env.DATAFORSEO_SERP_DEPTH ?? '10', 10));
  // Cost is per-task (not per-result): depth ≤10 = $0.0006, depth 100 = $0.00465; AIO add-on = +$0.0006
  const baseCostPerTask = depth <= 10 ? 0.0006 : 0.00465;
  const estimatedSpendUsd = inputs.length * (baseCostPerTask + 0.0006);

  // 3. R15 locale validation — reject unsupported (country, language) pairs
  const localeRejections: Array<{ country_code: string; language_code: string }> = [];
  const valid: ValidatedQuery[] = [];

  for (const q of inputs) {
    const locale = lookupDataForSeoLocale(q.country_code, q.language_code);
    if (!locale) {
      localeRejections.push({ country_code: q.country_code, language_code: q.language_code });
    } else {
      valid.push({ ...q, location_code: locale.location_code, vendor_language_code: locale.language_code });
    }
  }

  if (valid.length === 0) {
    return {
      status: 'active',
      events: [],
      telemetry: { connector: 'dataforseo_serp_byo', skipped: false, budget_usd: guard.budgetUsd },
      locale_rejections: localeRejections,
      poll_summary: { total: 0, retrieved: 0, timed_out: false },
      estimated_spend_usd: 0,
    };
  }

  // 4. R18 batch cap
  const maxBatch = Math.max(1, parseInt(env.DATAFORSEO_MAX_BATCH_PER_RUN ?? '500', 10));
  const capped = valid.slice(0, maxBatch);

  // 5. Build SerpApi with injected fetch + Basic Auth header
  // NEVER include Authorization header in error logs (base64 decodes to plaintext login:password)
  const apiKey = env.DATAFORSEO_API_KEY!;
  const api = new SerpApi('https://api.dataforseo.com', {
    fetch: (url: RequestInfo, init?: RequestInit): Promise<Response> =>
      fetchImpl(url as string, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Basic ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }),
  });

  // 6. POST in chunks of 100 (DataForSEO limit)
  const taskIdToQuery = new Map<string, ValidatedQuery>();
  const chunks = chunkArray(capped, CHUNK_SIZE);

  for (const chunk of chunks) {
    const tasks = chunk.map((q) => {
      const task = new SerpGoogleOrganicTaskPostRequestInfo();
      task.keyword = q.keyword;
      task.location_code = q.location_code;
      task.language_code = q.vendor_language_code;
      task.depth = depth;
      task.load_async_ai_overview = true;
      task.tag = `${q.keyword}|${q.country_code}|${q.language_code}`;
      return task;
    });

    const res = await api.googleOrganicTaskPost(tasks);
    const taskList = res.tasks ?? [];
    for (let i = 0; i < taskList.length; i++) {
      const taskInfo = taskList[i];
      if (taskInfo?.id && chunk[i]) {
        taskIdToQuery.set(taskInfo.id, chunk[i]);
      }
    }
  }

  // 7. Poll until all tasks retrieved or configurable ceiling exceeded
  const pollInitialMs = parseInt(env.DATAFORSEO_POLL_INITIAL_MS ?? String(DEFAULT_POLL_INITIAL_MS), 10);
  const pollCeilingMs = parseInt(env.DATAFORSEO_POLL_CEILING_MS ?? String(DEFAULT_POLL_CEILING_MS), 10);

  const totalTasks = taskIdToQuery.size;
  const retrieved = new Set<string>();
  const events: RawEventInput[] = [];
  const startTime = Date.now();
  let timedOut = false;
  let pollDelay = pollInitialMs;

  while (retrieved.size < totalTasks && Date.now() - startTime < pollCeilingMs) {
    await sleep(pollDelay);
    pollDelay = Math.min(pollDelay * 2, DEFAULT_POLL_MAX_MS);

    const readyRes = await api.googleOrganicTasksReady();
    const readyItems = readyRes.tasks?.[0]?.result ?? [];

    for (const readyItem of readyItems) {
      const taskId = readyItem.id;
      if (!taskId || retrieved.has(taskId) || !taskIdToQuery.has(taskId)) continue;

      try {
        const taskRes = await api.googleOrganicTaskGetAdvanced(taskId);
        const resultData = taskRes.tasks?.[0]?.result?.[0];

        if (resultData) {
          const query = taskIdToQuery.get(taskId)!;
          const fetchTime = new Date().toISOString();
          const itemTypes: string[] = resultData.item_types ?? [];
          const items: BaseSerpApiElementItem[] = (resultData.items ?? []) as BaseSerpApiElementItem[];

          const aioPresent = itemTypes.includes('ai_overview');
          const paaPresent = itemTypes.includes('people_also_ask');
          const featuredSnippetPresent = itemTypes.includes('featured_snippet');
          const knowledgePanelPresent = itemTypes.includes('knowledge_graph');
          const shoppingAdsPresent = itemTypes.includes('shopping') || itemTypes.includes('paid');

          // Compute once per task — duplicated on all organic rows (self-contained contract)
          const aioText = aioPresent ? extractAioText(items) : null;
          const paaEntries = paaPresent ? extractPaaEntries(items) : null;

          for (const item of items) {
            if (item.type !== 'organic') continue;
            const organic = item as OrganicSerpElementItem;
            // Truncate title/snippet to limit prompt injection surface at extraction boundary
            const title = String(organic.title ?? '').slice(0, 500);
            const snippet = String(organic.description ?? '').slice(0, 1000);

            events.push({
              source: 'dataforseo_serp',
              source_item_id: `dataforseo:${taskId}:${organic.rank_absolute}`,
              source_timestamp: fetchTime,
              text: `${title}\n${snippet}`.trim(),
              url: organic.url ?? '',
              metadata: {
                keyword: query.keyword,
                country_code: query.country_code,
                language_code: query.language_code,
                organic_position: organic.rank_absolute,
                domain: organic.domain ?? '',
                aio_present: aioPresent,
                paa_present: paaPresent,
                featured_snippet_present: featuredSnippetPresent,
                knowledge_panel_present: knowledgePanelPresent,
                shopping_ads_present: shoppingAdsPresent,
                aio_text: aioText,
                paa_entries: paaEntries,
                item_types: itemTypes,
              },
            });
          }
        }
      } catch {
        // Per-task error: log task ID and nothing else (never log Authorization / apiKey)
        console.error(`[dataforseo_serp_byo] task ${taskId} fetch failed`);
      }

      retrieved.add(taskId);
    }
  }

  if (retrieved.size < totalTasks) {
    timedOut = true;
  }

  return {
    status: 'active',
    events,
    telemetry: {
      connector: 'dataforseo_serp_byo',
      skipped: false,
      budget_usd: guard.budgetUsd,
    },
    locale_rejections: localeRejections.length > 0 ? localeRejections : undefined,
    poll_summary: { total: totalTasks, retrieved: retrieved.size, timed_out: timedOut },
    estimated_spend_usd: estimatedSpendUsd,
  };
};
