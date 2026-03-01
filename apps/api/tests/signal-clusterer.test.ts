import { describe, expect, it } from 'vitest';
import { clusterSignals, type ClusterableSignal } from '../src/jobs/signal_clusterer';

const makeSignal = (id: string, embedding: number[], blended = 50): ClusterableSignal => ({
  signal_id: id,
  canonical_text: `signal ${id}`,
  source: 'test',
  demand: 50,
  timing: 50,
  blended,
  embedding
});

// Helper: create an embedding that is "close" to a base by adding small noise
const nearEmbedding = (base: number[], noise = 0.01): number[] =>
  base.map((v) => v + (Math.random() - 0.5) * noise);

describe('signal clusterer', () => {
  it('groups similar signals into clusters', () => {
    // Create two distinct clusters: one around [1,0,...] and one around [0,1,...]
    const base1 = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
    const base2 = Array.from({ length: 768 }, (_, i) => (i === 1 ? 1 : 0));

    const signals: ClusterableSignal[] = [
      makeSignal('a1', nearEmbedding(base1, 0.001), 90),
      makeSignal('a2', nearEmbedding(base1, 0.001), 80),
      makeSignal('a3', nearEmbedding(base1, 0.001), 70),
      makeSignal('b1', nearEmbedding(base2, 0.001), 85),
      makeSignal('b2', nearEmbedding(base2, 0.001), 75),
    ];

    const clusters = clusterSignals(signals, { maxRepresentatives: 2 });
    expect(clusters.length).toBe(2);
    // Each cluster should have at most 2 representatives
    for (const c of clusters) {
      expect(c.representatives.length).toBeLessThanOrEqual(2);
    }
    // Total representatives should be 4 (2 from each cluster)
    const totalReps = clusters.reduce((sum, c) => sum + c.representatives.length, 0);
    expect(totalReps).toBe(4);
  });

  it('returns single cluster when all signals are similar', () => {
    const base = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
    const signals = [
      makeSignal('a', nearEmbedding(base, 0.001), 90),
      makeSignal('b', nearEmbedding(base, 0.001), 80),
    ];
    const clusters = clusterSignals(signals);
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.totalCount).toBe(2);
  });

  it('returns empty array for empty input', () => {
    expect(clusterSignals([])).toEqual([]);
  });

  it('filters out signals below blended threshold', () => {
    const base = Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0));
    const signals = [
      makeSignal('good', base, 60),
      makeSignal('bad', base, 10),
    ];
    const clusters = clusterSignals(signals, { minBlended: 30 });
    const allReps = clusters.flatMap((c) => c.representatives);
    expect(allReps.find((r) => r.signal_id === 'bad')).toBeUndefined();
  });

  it('caps total representatives', () => {
    // Create 50 very different signals
    const signals = Array.from({ length: 50 }, (_, i) => {
      const emb = Array.from({ length: 768 }, (_, j) => (j === i % 768 ? 1 : 0));
      return makeSignal(`s${i}`, emb, 60);
    });
    const clusters = clusterSignals(signals, { maxTotalRepresentatives: 10 });
    const totalReps = clusters.reduce((sum, c) => sum + c.representatives.length, 0);
    expect(totalReps).toBeLessThanOrEqual(10);
  });
});
