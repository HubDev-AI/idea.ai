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
});
