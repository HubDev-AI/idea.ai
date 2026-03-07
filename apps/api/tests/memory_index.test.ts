import { describe, expect, it, vi } from 'vitest';

vi.mock('@idea/ai-runtime/src/ollama', () => ({
  embedText: vi.fn().mockResolvedValue(Array.from({ length: 768 }, (_, i) => i * 0.001))
}));

import { buildCanonicalText, indexSignalMemory } from '../src/jobs/memory_index';

describe('memory indexing', () => {
  it('builds canonical text', () => {
    const canonical = buildCanonicalText({
      idea: 'SOC2 workflow copilot',
      snippet: 'Teams repeating painful compliance tasks',
      text: 'urgent and costly manual process around SOC2 evidence collection',
      topic: 'compliance'
    });

    expect(canonical).toContain('SOC2 workflow copilot');
  });

  it('creates memory and embedding records from scored signal input', async () => {
    const result = await indexSignalMemory({
      signalId: 'signal-1',
      topic: 'compliance',
      source: 'hn',
      idea: 'SOC2 workflow copilot',
      snippet: 'Teams repeating painful compliance tasks',
      text: 'urgent and costly manual process around SOC2 evidence collection',
      observedAt: '2026-02-24T00:00:00.000Z',
      demand: 77,
      timing: 64,
      buildability: 58,
      blended: 68.2,
      virality: 50
    });

    expect(result.memoryRecord.signal_id).toBe('signal-1');
    expect(result.embeddingRecord).not.toBeNull();
    expect(result.embeddingRecord!.embedding).toHaveLength(768);
    expect(result.embeddingRecord!.model).toBe('ollama-nomic-embed-text');
  });

  it('returns null embeddingRecord when Ollama is unavailable', async () => {
    const { embedText } = await import('@idea/ai-runtime/src/ollama');
    (embedText as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const result = await indexSignalMemory({
      signalId: 'signal-2',
      topic: 'ai',
      source: 'reddit',
      idea: 'Test idea',
      snippet: 'Test snippet',
      text: 'Test text',
      observedAt: '2026-02-24T00:00:00.000Z',
      demand: 50,
      timing: 50,
      buildability: 50,
      blended: 50,
      virality: 50
    });

    expect(result.memoryRecord.signal_id).toBe('signal-2');
    expect(result.embeddingRecord).toBeNull();
  });
});
