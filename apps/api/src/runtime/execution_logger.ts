import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export type ExecutionLogLevel = 'debug' | 'info' | 'warn' | 'error';

type ExecutionLogEntry = {
  ts: string;
  level: ExecutionLogLevel;
  run_id: string;
  component: string;
  message: string;
  context?: Record<string, unknown>;
};

export type ExecutionLogger = {
  runId: string;
  filePath: string;
  debug: (component: string, message: string, context?: Record<string, unknown>) => Promise<void>;
  info: (component: string, message: string, context?: Record<string, unknown>) => Promise<void>;
  warn: (component: string, message: string, context?: Record<string, unknown>) => Promise<void>;
  error: (component: string, message: string, context?: Record<string, unknown>) => Promise<void>;
};

const defaultLogDir = (): string => join(process.cwd(), 'logs', 'executions');

const sanitizeFileToken = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);

const normalizeError = (value: unknown): string => {
  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === 'string') {
    return value;
  }

  return 'Unknown error';
};

export const createRunId = (prefix = 'api'): string => `${sanitizeFileToken(prefix)}-${randomUUID()}`;

export const createExecutionLogger = ({
  env = process.env,
  runId = createRunId(),
  logDir = env.LOG_DIR ?? defaultLogDir()
}: {
  env?: NodeJS.ProcessEnv;
  runId?: string;
  logDir?: string;
} = {}): ExecutionLogger => {
  const safeRunId = sanitizeFileToken(runId);
  const filePath = join(logDir, `${safeRunId}.jsonl`);
  const ensureDir = mkdir(logDir, { recursive: true });

  const write = async (
    level: ExecutionLogLevel,
    component: string,
    message: string,
    context?: Record<string, unknown>
  ): Promise<void> => {
    const entry: ExecutionLogEntry = {
      ts: new Date().toISOString(),
      level,
      run_id: safeRunId,
      component,
      message
    };
    if (context !== undefined) entry.context = context;

    try {
      await ensureDir;
      await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (error) {
      const fallbackMessage = normalizeError(error);
      // Keep console fallback so logging failures do not block runtime behavior.
      console.error('execution logger write failed', fallbackMessage);
    }
  };

  return {
    runId: safeRunId,
    filePath,
    debug: async (component, message, context) => write('debug', component, message, context),
    info: async (component, message, context) => write('info', component, message, context),
    warn: async (component, message, context) => write('warn', component, message, context),
    error: async (component, message, context) => write('error', component, message, context)
  };
};
