import { describe, expect, it, vi } from 'vitest';

vi.mock('@idea/ai-runtime/src/ollama', () => ({
  embedText: vi.fn().mockResolvedValue(Array.from({ length: 768 }, (_, i) => i * 0.001))
}));

import { indexSignalMemory } from '../src/jobs/memory_index';
import { buildRetrieverQueryText, createInMemoryRetriever } from '../src/jobs/memory_retriever';
import { scoreSignalWithRetriever } from '../src/jobs/score';

describe('retriever-backed scoring', () => {
  it('loads memory context from retriever and applies memory-aware scoring', async () => {
    const indexed = await Promise.all([
      indexSignalMemory({
        signalId: 'hist-1',
        topic: 'compliance',
        source: 'hn',
        idea: 'SOC2 prep assistant',
        snippet: 'Founders repeating manual compliance tasks',
        text: 'urgent manual process and costly evidence collection',
        observedAt: '2026-02-22T00:00:00.000Z',
        demand: 82,
        timing: 69,
        buildability: 58,
        blended: 72
      }),
      indexSignalMemory({
        signalId: 'hist-2',
        topic: 'compliance',
        source: 'hn',
        idea: 'Audit workflow helper',
        snippet: 'Compliance teams still use spreadsheets',
        text: 'manual compliance tracking is still broken and painful',
        observedAt: '2026-02-16T00:00:00.000Z',
        demand: 76,
        timing: 61,
        buildability: 62,
        blended: 67
      })
    ]);

    const retriever = createInMemoryRetriever(indexed, new Date('2026-02-24T00:00:00.000Z'));

    const result = await scoreSignalWithRetriever({
      text: 'manual costly compliance process creates friction for teams',
      judgeScores: [60, 70, 65],
      topic: 'compliance',
      source: 'hn',
      canonicalText: buildRetrieverQueryText({
        idea: 'SOC2 workflow copilot',
        snippet: 'founders repeating evidence pain',
        text: 'manual costly compliance process creates friction for teams',
        topic: 'compliance'
      }),
      memoryRetriever: retriever
    });

    expect(result.memory.persistence).toBeGreaterThan(0);
    expect(result.memory.momentum).toBeGreaterThan(0);
    expect(result.blended).toBeGreaterThan(0);
  });
});
