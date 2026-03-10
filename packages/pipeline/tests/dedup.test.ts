import { describe, expect, it, vi } from 'vitest';
import { type EmbeddedSignal, findDuplicates } from '../src/dedup';

describe('cross-source dedup', () => {
  it('detects duplicates from different sources above threshold', async () => {
    // Create two near-identical vectors from different sources
    const baseVec = Array.from({ length: 10 }, (_, i) => i * 0.1);
    const nearDupe = baseVec.map((v) => v + 0.001);

    const signals: EmbeddedSignal[] = [
      { signal_id: 'hn-1', source: 'hn', embedding: baseVec },
      { signal_id: 'gh-1', source: 'github_issues', embedding: nearDupe },
      { signal_id: 'hn-2', source: 'hn', embedding: Array.from({ length: 10 }, () => Math.random()) }
    ];

    const dupes = await findDuplicates(signals, { threshold: 0.99 });
    expect(dupes).toHaveLength(1);
    expect(dupes[0]!.signals).toContain('hn-1');
    expect(dupes[0]!.signals).toContain('gh-1');
  });

  it('ignores same-source pairs', async () => {
    const vec = Array.from({ length: 10 }, (_, i) => i * 0.1);
    const signals: EmbeddedSignal[] = [
      { signal_id: 'hn-1', source: 'hn', embedding: vec },
      { signal_id: 'hn-2', source: 'hn', embedding: vec }
    ];

    const dupes = await findDuplicates(signals, { threshold: 0.99 });
    expect(dupes).toHaveLength(0);
  });
});

describe('findDuplicates with pgvector delegate', () => {
  it('uses pgFindDuplicates when provided', async () => {
    const pgFindDuplicates = vi.fn(async (signalId: string) => {
      if (signalId === 'hn-1') {
        return [{ signal_id: 'gh-1', source: 'github_issues', distance: 0.05 }];
      }
      return [];
    });

    const vec = Array.from({ length: 10 }, (_, i) => i * 0.1);
    const dupes = await findDuplicates(
      [
        { signal_id: 'hn-1', source: 'hn', embedding: vec },
        { signal_id: 'gh-1', source: 'github_issues', embedding: vec },
      ],
      { threshold: 0.92, pgFindDuplicates }
    );

    expect(pgFindDuplicates).toHaveBeenCalledWith('hn-1');
    expect(dupes.length).toBeGreaterThanOrEqual(1);
    expect(dupes[0]!.signals).toContain('gh-1');
  });
});
