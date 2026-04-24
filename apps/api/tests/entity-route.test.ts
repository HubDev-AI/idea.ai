import { describe, expect, it, vi } from 'vitest';
import { createEntityRoute } from '../src/runtime/entity_route';

describe('createEntityRoute', () => {
  it('uses codex directly when AI_PRIMARY=codex and AI_FALLBACK=none', async () => {
    const runCodex = vi.fn(async () => ({
      text: '{"entities":[],"relations":[]}',
      provider: 'codex' as const,
      meta: {}
    }));
    const runClaude = vi.fn(async () => ({
      text: '{"entities":[],"relations":[]}',
      provider: 'claude' as const,
      meta: {}
    }));

    const route = createEntityRoute({
      env: {
        AI_PRIMARY: 'codex',
        AI_FALLBACK: 'none',
        AI_TIMEOUT_MS: '12345'
      },
      runCodex,
      runClaude
    });

    const result = await route('entity_extraction', 'extract this');

    expect(result).toBe('{"entities":[],"relations":[]}');
    expect(runCodex).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'extract this',
      timeoutMs: 12345,
      preferredProvider: 'codex'
    }));
    expect(runClaude).not.toHaveBeenCalled();
  });

  it('falls back only when a fallback provider is configured', async () => {
    const runCodex = vi.fn(async () => {
      throw new Error('codex unavailable');
    });
    const runClaude = vi.fn(async () => ({
      text: '{"entities":[{"type":"trend","name":"fallback"}],"relations":[]}',
      provider: 'claude' as const,
      meta: {}
    }));

    const route = createEntityRoute({
      env: {
        AI_PRIMARY: 'codex',
        AI_FALLBACK: 'claude',
      },
      runCodex,
      runClaude
    });

    const result = await route('entity_extraction', 'extract this');

    expect(result).toContain('"fallback"');
    expect(runCodex).toHaveBeenCalledTimes(1);
    expect(runClaude).toHaveBeenCalledTimes(1);
  });

  it('delegates to the model router when routing is enabled', async () => {
    const route = createEntityRoute({
      modelRouter: {
        route: vi.fn(async (_task: string, prompt: string) => `router:${prompt}`)
      }
    });

    await expect(route('entity_extraction', 'extract this')).resolves.toBe('router:extract this');
  });
});
