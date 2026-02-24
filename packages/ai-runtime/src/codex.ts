import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CommandRunner, RunPromptInput, RunPromptResult } from './types';
import { spawnCommand } from './types';

const parseCodexText = (jsonl: string): string => {
  const lines = jsonl
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let fallbackText = '';

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        text?: string;
        output_text?: string;
      };

      if (parsed.type === 'final' && typeof parsed.text === 'string') {
        return parsed.text;
      }

      if (typeof parsed.output_text === 'string') {
        fallbackText = parsed.output_text;
      } else if (typeof parsed.text === 'string') {
        fallbackText = parsed.text;
      }
    } catch {
      // Ignore malformed lines.
    }
  }

  return fallbackText;
};

export const runCodexPrompt = async (
  input: RunPromptInput,
  deps: {
    runCommand?: CommandRunner;
    readFile?: (path: string) => Promise<string>;
    tempOutputPath?: string;
  } = {}
): Promise<RunPromptResult> => {
  const runCommand = deps.runCommand ?? spawnCommand;
  const readOutput = deps.readFile ?? ((path: string) => readFile(path, 'utf8'));
  const outputPath = deps.tempOutputPath ?? join(tmpdir(), `codex-output-${randomUUID()}.jsonl`);

  const result = await runCommand({
    cmd: 'codex',
    args: ['exec', '--json', '-o', outputPath, input.prompt],
    timeoutMs: input.timeoutMs
  });

  if (result.timedOut) {
    const timeoutError = new Error('codex timed out');
    (timeoutError as Error & { code?: string }).code = 'ETIMEDOUT';
    throw timeoutError;
  }

  if (result.exitCode !== 0) {
    const nonZeroError = new Error(`codex exited with code ${result.exitCode}: ${result.stderr}`.trim());
    (nonZeroError as Error & { code?: string }).code = 'ECODEX_NON_ZERO';
    throw nonZeroError;
  }

  const output = await readOutput(outputPath);

  return {
    text: parseCodexText(output),
    provider: 'codex',
    meta: {
      exitCode: result.exitCode,
      outputPath
    }
  };
};
