import type { FeedRecord, PaginatedFeedResponse } from '@idea/contracts/src/api';
import type { FastifyInstance } from 'fastify';

export type { FeedRecord, PaginatedFeedResponse } from '@idea/contracts/src/api';

const MAX_PAGE_SIZE = 100;

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
        output += value[index] + value[index + 1];
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

export const registerFeedRoute = (
  app: FastifyInstance,
  deps: { listSignals: () => Promise<FeedRecord[]> }
): void => {
  app.get<{ Querystring: { page?: string; page_size?: string } }>('/v1/signals', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'string', pattern: '^[0-9]+$' },
          page_size: { type: 'string', pattern: '^[0-9]+$' }
        }
      }
    }
  }, async (request) => {
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
