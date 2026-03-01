import type { FeedRecord, PaginatedFeedResponse } from '@idea/contracts/src/api';
import type { FastifyInstance } from 'fastify';
import type {
  MemorySignalRow,
  PostgresMemoryStore
} from '../runtime/postgres_memory_store';

export type { FeedRecord, PaginatedFeedResponse } from '@idea/contracts/src/api';

const MAX_PAGE_SIZE = 100;

const WINDOW_MAP: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30, all: 3650 };

const VALID_WINDOWS = new Set(Object.keys(WINDOW_MAP));

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
};

const sanitizeText = (value: string): string => {
  let output = '';

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;

    if (isHigh) {
      const nextCode = value.charCodeAt(index + 1);
      const nextIsLow = nextCode >= 0xdc00 && nextCode <= 0xdfff;
      if (nextIsLow) {
        output += value[index]! + value[index + 1]!;
        index += 1;
      } else {
        output += '\uFFFD';
      }
      continue;
    }

    if (isLow) {
      output += '\uFFFD';
      continue;
    }

    output += value[index];
  }

  return output;
};

const sanitizeFeedRecord = (record: FeedRecord): FeedRecord => ({
  ...record,
  idea: sanitizeText(record.idea),
  top_source: sanitizeText(record.top_source),
  snippet: sanitizeText(record.snippet),
  source_url: record.source_url ? sanitizeText(record.source_url) : null,
  next_action: sanitizeText(record.next_action) as FeedRecord['next_action'],
  updated_at: sanitizeText(record.updated_at)
});

const signalToFeedRecord = (row: MemorySignalRow): FeedRecord => ({
  idea: row.canonical_text,
  score: row.blended,
  top_source: row.source,
  snippet: row.canonical_text.slice(0, 200),
  source_url: row.source_url ?? null,
  next_action: 'validate_demand',
  updated_at: row.observed_at,
  demand: row.demand,
  timing: row.timing,
  buildability: row.buildability,
  virality: row.virality,
});

export type FeedDeps = {
  listSignals: () => Promise<FeedRecord[]>;
  memoryStore?: PostgresMemoryStore | null;
};

export const registerFeedRoute = (
  app: FastifyInstance,
  deps: FeedDeps
): void => {
  app.get<{
    Querystring: {
      page?: string;
      page_size?: string;
      window?: string;
      source?: string;
      thesis_key?: string;
    };
  }>('/v1/signals', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'string', pattern: '^[0-9]+$' },
          page_size: { type: 'string', pattern: '^[0-9]+$' },
          window: { type: 'string' },
          source: { type: 'string' },
          thesis_key: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const windowParam = request.query.window;

    // Validate window param if present
    if (windowParam !== undefined && !VALID_WINDOWS.has(windowParam)) {
      reply.code(400);
      return { error: `Invalid window value: ${windowParam}. Must be one of: ${[...VALID_WINDOWS].join(', ')}` };
    }

    const sourceParam = request.query.source;
    const thesisKeyParam = request.query.thesis_key;

    // When memoryStore is available, use DB-backed pagination via querySignals
    if (deps.memoryStore) {
      const windowDays = WINDOW_MAP[windowParam ?? '7d'] ?? 7;
      const requestedPageSize = parsePositiveInt(request.query.page_size, 20);
      const pageSize = Math.min(MAX_PAGE_SIZE, requestedPageSize);
      const page = parsePositiveInt(request.query.page, 1);

      const queryParams: Parameters<typeof deps.memoryStore.querySignals>[0] = {
        windowDays,
        page,
        pageSize
      };
      if (sourceParam !== undefined) queryParams.source = sourceParam;
      if (thesisKeyParam !== undefined) queryParams.thesisKey = thesisKeyParam;
      const result = await deps.memoryStore.querySignals(queryParams);

      const items = result.items
        .map(signalToFeedRecord)
        .map(sanitizeFeedRecord);

      const payload: PaginatedFeedResponse = {
        items,
        page: result.page,
        page_size: result.pageSize,
        total_items: result.totalItems,
        total_pages: result.totalPages,
        has_next: result.hasNext,
        has_prev: result.hasPrev,
      };

      return payload;
    }

    // Fallback: in-memory snapshot with client-side pagination
    const allSignals = await deps.listSignals();
    const requestedPageSize = parsePositiveInt(request.query.page_size, 20);
    const pageSize = Math.min(MAX_PAGE_SIZE, requestedPageSize);
    const totalItems = allSignals.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const requestedPage = parsePositiveInt(request.query.page, 1);
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * pageSize;
    const items = allSignals.slice(offset, offset + pageSize).map((record) => sanitizeFeedRecord(record));

    const payload: PaginatedFeedResponse = {
      items,
      page,
      page_size: pageSize,
      total_items: totalItems,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1
    };

    return payload;
  });
};
