import type { FastifyInstance } from 'fastify';

export type ExecutionLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ExecutionLogRecord = {
  ts: string;
  level: ExecutionLogLevel;
  run_id: string;
  component: string;
  message: string;
  context?: Record<string, unknown>;
};

export type ListLogsQuery = {
  limit: number;
  level?: ExecutionLogLevel;
  run_id?: string;
  scope?: 'session' | 'all';
};

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
  const resolveQuery = (query: { limit?: string; level?: string; run_id?: string; scope?: string }): ListLogsQuery => {
    const limit = Math.min(1000, parsePositiveInt(query.limit, 200));
    const level = parseLevel(query.level);
    const runId = query.run_id?.trim();
    const scope = parseScope(query.scope);

    return {
      limit,
      level,
      run_id: runId ? runId : undefined,
      scope
    };
  };

  app.get<{ Querystring: { limit?: string; level?: string; run_id?: string; scope?: string } }>(
    '/v1/logs',
    async (request) => {
      return deps.listLogs(resolveQuery(request.query));
    }
  );

  app.get<{ Querystring: { limit?: string; level?: string; run_id?: string; scope?: string } }>(
    '/v1/logs/stream',
    async (request, reply) => {
      const query = resolveQuery(request.query);
      const response = reply.raw;

      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders?.();

      let lastPayload = '';
      let closed = false;

      const send = async () => {
        if (closed) {
          return;
        }

        try {
          const rows = await deps.listLogs(query);
          const payload = JSON.stringify(rows);
          if (payload === lastPayload) {
            response.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
            return;
          }

          lastPayload = payload;
          response.write(`event: logs\ndata: ${payload}\n\n`);
        } catch (error) {
          const payload = JSON.stringify({
            message: error instanceof Error ? error.message : 'Failed to read logs'
          });
          response.write(`event: stream_error\ndata: ${payload}\n\n`);
        }
      };

      const timer = setInterval(() => {
        void send();
      }, 1000);

      request.raw.on('close', () => {
        closed = true;
        clearInterval(timer);
      });

      await send();
      return reply;
    }
  );
};
