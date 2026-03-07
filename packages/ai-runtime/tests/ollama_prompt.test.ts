import { describe, expect, it, vi } from 'vitest';
import { runOllamaPrompt } from '../src/ollama_prompt';

const mockFetch = (response: string, ok = true) =>
  vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve({ response }),
  });

describe('runOllamaPrompt', () => {
  it('sends prompt to Ollama generate endpoint', async () => {
    const fetch = mockFetch('The answer is 42');
    const result = await runOllamaPrompt('What is the meaning?', {
      model: 'llama3.2:3b',
      fetchImpl: fetch,
    });
    expect(result).toBe('The answer is 42');
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/generate',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"model":"llama3.2:3b"'),
      })
    );
  });

  it('uses custom baseUrl', async () => {
    const fetch = mockFetch('ok');
    await runOllamaPrompt('test', { baseUrl: 'http://gpu:11434', fetchImpl: fetch });
    expect(fetch).toHaveBeenCalledWith(
      'http://gpu:11434/api/generate',
      expect.any(Object)
    );
  });

  it('throws on non-ok response', async () => {
    const fetch = mockFetch('', false);
    await expect(runOllamaPrompt('test', { fetchImpl: fetch })).rejects.toThrow('Ollama returned 500');
  });

  it('respects timeoutMs via AbortSignal', async () => {
    const fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })
    );
    await expect(
      runOllamaPrompt('test', { fetchImpl: fetch, timeoutMs: 50 })
    ).rejects.toThrow();
  });
});
