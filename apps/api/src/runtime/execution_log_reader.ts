import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExecutionLogLevel, ExecutionLogRecord } from '../routes/logs';

const defaultLogDir = (): string => join(process.cwd(), 'logs', 'executions');

const parseLine = (line: string): ExecutionLogRecord | null => {
  try {
    const parsed = JSON.parse(line) as Partial<ExecutionLogRecord>;

    if (
      !parsed ||
      typeof parsed.ts !== 'string' ||
      typeof parsed.level !== 'string' ||
      typeof parsed.run_id !== 'string' ||
      typeof parsed.component !== 'string' ||
      typeof parsed.message !== 'string'
    ) {
      return null;
    }

    if (parsed.level !== 'debug' && parsed.level !== 'info' && parsed.level !== 'warn' && parsed.level !== 'error') {
      return null;
    }

    return {
      ts: parsed.ts,
      level: parsed.level,
      run_id: parsed.run_id,
      component: parsed.component,
      message: parsed.message,
      context:
        parsed.context && typeof parsed.context === 'object' && !Array.isArray(parsed.context)
          ? (parsed.context as Record<string, unknown>)
          : undefined
    };
  } catch {
    return null;
  }
};

const toTimestamp = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const readExecutionLogs = async ({
  env = process.env,
  limit,
  level,
  runId
}: {
  env?: NodeJS.ProcessEnv;
  limit: number;
  level?: ExecutionLogLevel;
  runId?: string;
}): Promise<ExecutionLogRecord[]> => {
  const logDir = env.LOG_DIR ?? defaultLogDir();
  const fileNames = await readdir(logDir).catch(() => []);
  const jsonlFiles = fileNames.filter((name) => name.endsWith('.jsonl'));

  const all: ExecutionLogRecord[] = [];

  for (const file of jsonlFiles) {
    const filePath = join(logDir, file);
    const content = await readFile(filePath, 'utf8').catch(() => '');
    if (!content) {
      continue;
    }

    const rows = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseLine(line))
      .filter((entry): entry is ExecutionLogRecord => entry !== null);

    all.push(...rows);
  }

  const filtered = all.filter((entry) => {
    if (level && entry.level !== level) {
      return false;
    }

    if (runId && entry.run_id !== runId) {
      return false;
    }

    return true;
  });

  return filtered.sort((left, right) => toTimestamp(right.ts) - toTimestamp(left.ts)).slice(0, limit);
};
