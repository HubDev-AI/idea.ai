import { describe, expect, it } from 'vitest';
import { runClaudePrompt } from '../src/claude';
import { runPrompt } from '../src/client';
import { runCodexPrompt } from '../src/codex';

describe('ai runtime client', () => {
  it('uses claude -p as primary command', async () => {
    const seen: Array<{ cmd: string; args: string[] }> = [];

    const result = await runClaudePrompt(
      { prompt: 'hello world', timeoutMs: 1000 },
      {
        runCommand: async (command) => {
          seen.push({ cmd: command.cmd, args: command.args });

          return {
            exitCode: 0,
            stdout: '{"content":[{"type":"text","text":"hello from claude"}]}',
            stderr: '',
            timedOut: false
          };
        }
      }
    );

    expect(seen[0]?.cmd).toBe('claude');
    expect(seen[0]?.args.slice(0, 2)).toEqual(['-p', 'hello world']);
    expect(result.text).toBe('hello from claude');
  });

  it('falls back to codex on timeout or non-zero exit', async () => {
    const result = await runPrompt(
      { prompt: 'help', timeoutMs: 1000, preferredProvider: 'claude' },
      {
        runClaude: async () => {
          const error = new Error('timeout');
          (error as Error & { code?: string }).code = 'ETIMEDOUT';
          throw error;
        },
        runCodex: async () => ({ text: 'from codex fallback', provider: 'codex', meta: {} })
      }
    );

    expect(result.provider).toBe('codex');
    expect(result.text).toBe('from codex fallback');
  });

  it('uses codex exec --json and parses item.completed JSONL from stdout', async () => {
    const seen: Array<{ cmd: string; args: string[] }> = [];
    const codexJsonl = [
      '{"type":"thread.started","thread_id":"abc-123"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"Thinking..."}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"codex final text"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":10}}'
    ].join('\n');

    const result = await runCodexPrompt(
      { prompt: 'hello', timeoutMs: 1000 },
      {
        runCommand: async (command) => {
          seen.push({ cmd: command.cmd, args: command.args });

          return {
            exitCode: 0,
            stdout: codexJsonl,
            stderr: '',
            timedOut: false
          };
        }
      }
    );

    expect(seen[0]?.cmd).toBe('codex');
    expect(seen[0]?.args).toContain('exec');
    expect(seen[0]?.args).toContain('--json');
    expect(seen[0]?.args).not.toContain('-o');
    expect(result.text).toBe('codex final text');
  });

  it('parses plain-text codex stdout when jsonl events are not present', async () => {
    const result = await runCodexPrompt(
      { prompt: 'hello', timeoutMs: 1000 },
      {
        runCommand: async () => ({
          exitCode: 0,
          stdout: '84,71,79',
          stderr: '',
          timedOut: false
        })
      }
    );

    expect(result.text).toBe('84,71,79');
  });
});
