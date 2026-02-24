import type { CommandRunner, RunPromptInput, RunPromptResult } from './types';
import { spawnCommand } from './types';

const extractClaudeText = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      content?: Array<{ type?: string; text?: string }>;
      text?: string;
      output_text?: string;
    };

    if (parsed.output_text) {
      return parsed.output_text;
    }

    if (parsed.text) {
      return parsed.text;
    }

    const contentText = parsed.content?.find((entry) => entry.type === 'text')?.text;
    return contentText ?? trimmed;
  } catch {
    return trimmed;
  }
};

export const runClaudePrompt = async (
  input: RunPromptInput,
  deps: { runCommand?: CommandRunner } = {}
): Promise<RunPromptResult> => {
  const runCommand = deps.runCommand ?? spawnCommand;

  const result = await runCommand({
    cmd: 'claude',
    args: ['-p', input.prompt, '--output-format', 'json'],
    timeoutMs: input.timeoutMs
  });

  if (result.timedOut) {
    const timeoutError = new Error('claude timed out');
    (timeoutError as Error & { code?: string }).code = 'ETIMEDOUT';
    throw timeoutError;
  }

  if (result.exitCode !== 0) {
    const nonZeroError = new Error(`claude exited with code ${result.exitCode}: ${result.stderr}`.trim());
    (nonZeroError as Error & { code?: string }).code = 'ECLAUDE_NON_ZERO';
    throw nonZeroError;
  }

  return {
    text: extractClaudeText(result.stdout),
    provider: 'claude',
    meta: {
      exitCode: result.exitCode
    }
  };
};
