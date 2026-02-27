import { describe, expect, it } from 'vitest';
import { mergeByRRF, type RankedResult } from '../src/memory/hybrid_search';

describe('hybrid search', () => {
  describe('reciprocal rank fusion', () => {
    it('merges vector and text results by RRF', () => {
      const vectorResults: RankedResult[] = [
        { signal_id: 'a', rank: 1 },
        { signal_id: 'b', rank: 2 },
        { signal_id: 'c', rank: 3 }
      ];
      const textResults: RankedResult[] = [
        { signal_id: 'b', rank: 1 },
        { signal_id: 'd', rank: 2 },
        { signal_id: 'a', rank: 3 }
      ];

      const merged = mergeByRRF(vectorResults, textResults, { k: 60 });

      // 'b' appears in both lists (rank 2 + rank 1) → highest RRF
      // 'a' appears in both lists (rank 1 + rank 3) → second highest
      expect(merged[0]!.signal_id).toBe('b');
      expect(merged[1]!.signal_id).toBe('a');
      expect(merged.length).toBe(4);
    });

    it('handles empty inputs', () => {
      expect(mergeByRRF([], [], { k: 60 })).toEqual([]);
    });
  });
});
