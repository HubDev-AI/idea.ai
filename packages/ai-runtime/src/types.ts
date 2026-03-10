import { spawn } from 'node:child_process';

export type Provider = 'claude' | 'codex';

export type RunPromptInput = {
  prompt: string;
  timeoutMs?: number;
  preferredProvider?: Provider;
};

export type RunPromptResult = {
  text: string;
  provider: Provider;
  meta: Record<string, unknown>;
};

export type CommandSpec = {
  cmd: string;
  args: string[];
  timeoutMs?: number;
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type CommandRunner = (spec: CommandSpec) => Promise<CommandResult>;

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_BUFFER = 1_048_576; // 1MB

export const spawnCommand: CommandRunner = ({ cmd, args, timeoutMs = DEFAULT_TIMEOUT_MS }) =>
  new Promise((resolve, reject) => {
    const { CLAUDECODE, ...cleanEnv } = process.env;
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cleanEnv
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let bufferExceeded = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (bufferExceeded) return;
      const str = chunk.toString();
      stdout += str;
      if (stdout.length > MAX_BUFFER) {
        stdout = stdout.slice(0, MAX_BUFFER);
        bufferExceeded = true;
        child.kill('SIGTERM');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (bufferExceeded) return;
      const str = chunk.toString();
      stderr += str;
      if (stderr.length > MAX_BUFFER) {
        stderr = stderr.slice(0, MAX_BUFFER);
        bufferExceeded = true;
        child.kill('SIGTERM');
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);

      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
        timedOut
      });
    });
  });
