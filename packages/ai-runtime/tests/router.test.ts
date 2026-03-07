import { describe, expect, it, vi } from 'vitest';
import { createRouter } from '../src/router';
import type { RouterDeps } from '../src/router';

const makeDeps = (overrides: Partial<RouterDeps> = {}): RouterDeps => ({
  runOllama: vi.fn().mockResolvedValue('ollama result'),
  runCli: vi.fn().mockResolvedValue({ text: 'cli result', provider: 'claude', meta: {} }),
  ollamaCheapModel: 'llama3.2:3b',
  ollamaMediumModel: 'qwen2.5:7b',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaTimeoutMs: 30_000,
  ...overrides,
});

describe('createRouter', () => {
  it('routes cheap tasks to Ollama', async () => {
    const deps = makeDeps();
    const router = createRouter(deps);
    const result = await router.route('noise_classification', 'Is this signal relevant?');
    expect(deps.runOllama).toHaveBeenCalledWith('Is this signal relevant?', expect.objectContaining({ model: 'llama3.2:3b' }));
    expect(result).toBe('ollama result');
  });

  it('routes expensive tasks to CLI', async () => {
    const deps = makeDeps();
    const router = createRouter(deps);
    const result = await router.route('thesis_synthesis', 'Analyze these clusters...');
    expect(deps.runCli).toHaveBeenCalled();
    expect(result).toBe('cli result');
  });

  it('routes medium tasks to Ollama with CLI fallback', async () => {
    const deps = makeDeps({
      runOllama: vi.fn().mockRejectedValue(new Error('model not loaded')),
    });
    const router = createRouter(deps);
    const result = await router.route('basic_scoring', 'Score this signal');
    expect(deps.runOllama).toHaveBeenCalled();
    expect(deps.runCli).toHaveBeenCalled();
    expect(result).toBe('cli result');
  });

  it('throws on cheap task Ollama failure (no fallback)', async () => {
    const deps = makeDeps({
      runOllama: vi.fn().mockRejectedValue(new Error('timeout')),
    });
    const router = createRouter(deps);
    await expect(router.route('noise_classification', 'test')).rejects.toThrow('timeout');
  });

  it('routes unknown tasks to CLI', async () => {
    const deps = makeDeps();
    const router = createRouter(deps);
    const result = await router.route('unknown_task', 'test');
    expect(deps.runCli).toHaveBeenCalled();
  });

  it('starts with zeroed stats', () => {
    const router = createRouter(makeDeps());
    const stats = router.getStats();
    expect(stats).toEqual({
      ollamaCalls: 0, ollamaSucceeded: 0, ollamaFailed: 0,
      cliCalls: 0, cliSucceeded: 0, cliFailed: 0, fallbacks: 0,
    });
  });

  it('tracks Ollama success stats', async () => {
    const router = createRouter(makeDeps());
    await router.route('noise_classification', 'test');
    const stats = router.getStats();
    expect(stats.ollamaCalls).toBe(1);
    expect(stats.ollamaSucceeded).toBe(1);
    expect(stats.ollamaFailed).toBe(0);
    expect(stats.cliCalls).toBe(0);
  });

  it('tracks CLI success stats for expensive tasks', async () => {
    const router = createRouter(makeDeps());
    await router.route('thesis_synthesis', 'test');
    const stats = router.getStats();
    expect(stats.cliCalls).toBe(1);
    expect(stats.cliSucceeded).toBe(1);
    expect(stats.ollamaCalls).toBe(0);
  });

  it('tracks fallback stats on Ollama failure with CLI fallback', async () => {
    const router = createRouter(makeDeps({
      runOllama: vi.fn().mockRejectedValue(new Error('fail')),
    }));
    await router.route('basic_scoring', 'test');
    const stats = router.getStats();
    expect(stats.ollamaCalls).toBe(1);
    expect(stats.ollamaFailed).toBe(1);
    expect(stats.ollamaSucceeded).toBe(0);
    expect(stats.fallbacks).toBe(1);
    expect(stats.cliCalls).toBe(1);
    expect(stats.cliSucceeded).toBe(1);
  });

  it('resets stats to zero', async () => {
    const router = createRouter(makeDeps());
    await router.route('noise_classification', 'test');
    expect(router.getStats().ollamaCalls).toBe(1);
    router.resetStats();
    expect(router.getStats()).toEqual({
      ollamaCalls: 0, ollamaSucceeded: 0, ollamaFailed: 0,
      cliCalls: 0, cliSucceeded: 0, cliFailed: 0, fallbacks: 0,
    });
  });

  it('getStats returns a copy (not mutable reference)', async () => {
    const router = createRouter(makeDeps());
    await router.route('noise_classification', 'test');
    const stats = router.getStats();
    stats.ollamaCalls = 999;
    expect(router.getStats().ollamaCalls).toBe(1);
  });
});
