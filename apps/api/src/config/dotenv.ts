import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const parseEnvValue = (raw: string): string => {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

export const loadEnvFile = (filePath = '.env'): void => {
  const absolute = resolve(process.cwd(), filePath);
  if (!existsSync(absolute)) {
    return;
  }

  const content = readFileSync(absolute, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    if (!key || key in process.env) {
      continue;
    }

    const value = parseEnvValue(trimmed.slice(separator + 1));
    process.env[key] = value;
  }
};
