import { describe, expect, it, vi } from 'vitest';
import { embedText, type OllamaEmbedResponse } from '../src/ollama';

describe('ollama embedding client', () => {
  it('returns a 768-dim vector for valid text', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: [Array.from({ length: 768 }, (_, i) => i * 0.001)]
      } satisfies OllamaEmbedResponse)
    });

    const result = await embedText('test input', { fetchImpl: mockFetch });

    expect(result).toHaveLength(768);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/embed',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('nomic-embed-text')
      })
    );
  });

  it('throws on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(embedText('fail', { fetchImpl: mockFetch })).rejects.toThrow('Ollama');
  });

  it('returns null when Ollama is unreachable', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await embedText('test', { fetchImpl: mockFetch, fallbackToNull: true });
    expect(result).toBeNull();
  });
});
