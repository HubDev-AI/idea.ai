import { describe, it, expect } from 'vitest';
import { spawnCommand } from '../src/types';

describe('spawnCommand buffer cap', () => {
  it('kills child process when stdout exceeds MAX_BUFFER', async () => {
    const result = await spawnCommand({
      cmd: 'yes',
      args: ['AAAAAAAAAA'],
      timeoutMs: 10_000
    });
    expect(result.stdout.length).toBeLessThanOrEqual(1_048_576 + 1024);
    expect(result.exitCode).not.toBe(0);
  });
});
