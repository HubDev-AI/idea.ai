import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExecutionLogLevel, ExecutionLogRecord } from '../routes/logs';
import { EXEC_LOG_DIR } from './db_utils';

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

    const record: ExecutionLogRecord = {
      ts: parsed.ts,
      level: parsed.level,
      run_id: parsed.run_id,
      component: parsed.component,
      message: parsed.message
    };
    if (parsed.context && typeof parsed.context === 'object' && !Array.isArray(parsed.context)) {
      record.context = parsed.context as Record<string, unknown>;
    }
    return record;
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
  runId,
  component
}: {
  env?: NodeJS.ProcessEnv;
  limit: number;
  level?: ExecutionLogLevel;
  runId?: string;
  component?: string;
}): Promise<ExecutionLogRecord[]> => {
  const logDir = env.LOG_DIR ?? EXEC_LOG_DIR;
  const fileNames = await readdir(logDir).catch(() => []);
  const jsonlFiles = fileNames.filter((name) => name.endsWith('.jsonl'));

  if (runId) {
    const targetFile = jsonlFiles.find((name) => name.includes(runId));
    if (!targetFile) return [];
    const filePath = join(logDir, targetFile);
    const content = await readFile(filePath, 'utf8').catch(() => '');
    if (!content) return [];
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseLine)
      .filter((entry): entry is ExecutionLogRecord => entry !== null)
      .filter((entry) => (!level || entry.level === level) && (!component || entry.component === component))
      .sort((a, b) => toTimestamp(b.ts) - toTimestamp(a.ts))
      .slice(0, limit);
  }

  const MAX_LOG_FILES = 50;
  const recentFiles = jsonlFiles.sort().slice(-MAX_LOG_FILES);

  const all: ExecutionLogRecord[] = [];

  for (const file of recentFiles) {
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

    if (component && entry.component !== component) {
      return false;
    }

    return true;
  });

  return filtered.sort((left, right) => toTimestamp(right.ts) - toTimestamp(left.ts)).slice(0, limit);
};
