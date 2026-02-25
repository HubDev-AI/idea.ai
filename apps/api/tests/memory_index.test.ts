import { describe, expect, it } from 'vitest';
import { buildCanonicalText, buildLocalEmbedding, indexSignalMemory } from '../src/jobs/memory_index';

describe('memory indexing', () => {
  it('builds canonical text and stable embedding length', () => {
    const canonical = buildCanonicalText({
      idea: 'SOC2 workflow copilot',
      snippet: 'Teams repeating painful compliance tasks',
      text: 'urgent and costly manual process around SOC2 evidence collection',
      topic: 'compliance'
    });

    expect(canonical).toContain('SOC2 workflow copilot');
    expect(buildLocalEmbedding(canonical)).toHaveLength(32);
  });

  it('creates memory and embedding records from scored signal input', () => {
    const result = indexSignalMemory({
      signalId: 'signal-1',
      topic: 'compliance',
      source: 'hn',
      idea: 'SOC2 workflow copilot',
      snippet: 'Teams repeating painful compliance tasks',
      text: 'urgent and costly manual process around SOC2 evidence collection',
      observedAt: '2026-02-24T00:00:00.000Z',
      pain: 77,
      timing: 64,
      buildability: 58,
      blended: 68.2
    });

    expect(result.memoryRecord.signal_id).toBe('signal-1');
    expect(result.embeddingRecord.embedding).toHaveLength(32);
  });
});
