import { describe, expect, it } from 'vitest';
import { type EmbeddedSignal, findDuplicates } from '../src/dedup';

describe('cross-source dedup', () => {
  it('detects duplicates from different sources above threshold', () => {
    // Create two near-identical vectors from different sources
    const baseVec = Array.from({ length: 10 }, (_, i) => i * 0.1);
    const nearDupe = baseVec.map((v) => v + 0.001);

    const signals: EmbeddedSignal[] = [
      { signal_id: 'hn-1', source: 'hn', embedding: baseVec },
      { signal_id: 'gh-1', source: 'github_issues', embedding: nearDupe },
      { signal_id: 'hn-2', source: 'hn', embedding: Array.from({ length: 10 }, () => Math.random()) }
    ];

    const dupes = findDuplicates(signals, { threshold: 0.99 });
    expect(dupes).toHaveLength(1);
    expect(dupes[0]!.signals).toContain('hn-1');
    expect(dupes[0]!.signals).toContain('gh-1');
  });

  it('ignores same-source pairs', () => {
    const vec = Array.from({ length: 10 }, (_, i) => i * 0.1);
    const signals: EmbeddedSignal[] = [
      { signal_id: 'hn-1', source: 'hn', embedding: vec },
      { signal_id: 'hn-2', source: 'hn', embedding: vec }
    ];

    const dupes = findDuplicates(signals, { threshold: 0.99 });
    expect(dupes).toHaveLength(0);
  });
});
