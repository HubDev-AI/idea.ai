import type { ExecutionLogLevel, ExecutionLogRecord, ListLogsQuery } from '@idea/contracts/src/api';
import type { FastifyInstance } from 'fastify';

export type { ExecutionLogLevel, ExecutionLogRecord, ListLogsQuery } from '@idea/contracts/src/api';

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
};

const parseLevel = (value: string | undefined): ExecutionLogLevel | undefined => {
  if (!value) {
    return undefined;
  }

  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }

  return undefined;
};

const parseScope = (value: string | undefined): 'session' | 'all' => {
  if (value === 'all') {
    return 'all';
  }

  return 'session';
};

export const registerLogsRoute = (
  app: FastifyInstance,
  deps: { listLogs: (query: ListLogsQuery) => Promise<ExecutionLogRecord[]> }
): void => {
  const resolveQuery = (query: { limit?: string; level?: string; run_id?: string; scope?: string; component?: string }): ListLogsQuery => {
    const limit = Math.min(1000, parsePositiveInt(query.limit, 200));
    const level = parseLevel(query.level);
    const runId = query.run_id?.trim();
    const scope = parseScope(query.scope);
    const component = query.component?.trim();

    const result: ListLogsQuery = { limit, scope };
    if (level !== undefined) result.level = level;
    if (runId) result.run_id = runId;
    if (component) result.component = component;
    return result;
  };

  const logsQuerySchema = {
    type: 'object' as const,
    properties: {
      limit: { type: 'string' as const, pattern: '^[0-9]+$' },
      level: { type: 'string' as const, enum: ['debug', 'info', 'warn', 'error'] },
      run_id: { type: 'string' as const },
      scope: { type: 'string' as const, enum: ['all', 'session'] },
      component: { type: 'string' as const, maxLength: 100 }
    }
  };

  app.get<{ Querystring: { limit?: string; level?: string; run_id?: string; scope?: string; component?: string } }>(
    '/v1/logs',
    {
      schema: { querystring: logsQuerySchema }
    },
    async (request) => {
      return deps.listLogs(resolveQuery(request.query));
    }
  );

};
