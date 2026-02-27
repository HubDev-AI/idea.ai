import type { CommandRunner, CommandSpec, RunPromptInput, RunPromptResult } from './types';
import { spawnCommand } from './types';

const parseCodexText = (jsonl: string): string => {
  const lines = jsonl
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return '';
  }

  let fallbackText = '';
  let parsedAnyJson = false;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        text?: string;
        output_text?: string;
        output?: string;
        content?: string;
      };
      parsedAnyJson = true;

      if (parsed.type === 'final' && typeof parsed.text === 'string') {
        return parsed.text;
      }

      if (typeof parsed.output_text === 'string') {
        fallbackText = parsed.output_text;
      } else if (typeof parsed.output === 'string') {
        fallbackText = parsed.output;
      } else if (typeof parsed.content === 'string') {
        fallbackText = parsed.content;
      } else if (typeof parsed.text === 'string') {
        fallbackText = parsed.text;
      }
    } catch {
      // Ignore malformed lines.
    }
  }

  if (!parsedAnyJson) {
    return jsonl.trim();
  }

  return fallbackText;
};

export const runCodexPrompt = async (
  input: RunPromptInput,
  deps: {
    runCommand?: CommandRunner;
  } = {}
): Promise<RunPromptResult> => {
  const runCommand = deps.runCommand ?? spawnCommand;

  const spec: CommandSpec = {
    cmd: 'codex',
    args: ['exec', '--json', input.prompt]
  };
  if (input.timeoutMs !== undefined) {
    spec.timeoutMs = input.timeoutMs;
  }
  const result = await runCommand(spec);

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

  return {
    text: parseCodexText(result.stdout),
    provider: 'codex',
    meta: {
      exitCode: result.exitCode
    }
  };
};
