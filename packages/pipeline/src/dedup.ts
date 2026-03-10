export type EmbeddedSignal = {
  signal_id: string;
  source: string;
  embedding: number[];
};

export type DuplicateCluster = {
  signals: string[];
  similarity: number;
};

export type PgFindDuplicates = (signalId: string) => Promise<{ signal_id: string; source: string; distance: number }[]>;

const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
};

export const findDuplicates = async (
  signals: EmbeddedSignal[],
  options: { threshold?: number; pgFindDuplicates?: PgFindDuplicates } = {}
): Promise<DuplicateCluster[]> => {
  if (options.pgFindDuplicates) {
    return findDuplicatesPgvector(signals, options.pgFindDuplicates);
  }
  return findDuplicatesJs(signals, options.threshold ?? 0.92);
};

const findDuplicatesPgvector = async (
  signals: EmbeddedSignal[],
  pgFind: PgFindDuplicates
): Promise<DuplicateCluster[]> => {
  const clusters: DuplicateCluster[] = [];
  const seen = new Set<string>();

  for (const signal of signals) {
    if (seen.has(signal.signal_id)) continue;
    const matches = await pgFind(signal.signal_id);
    for (const match of matches) {
      if (seen.has(match.signal_id)) continue;
      clusters.push({
        signals: [signal.signal_id, match.signal_id],
        similarity: Math.round((1 - match.distance) * 1000) / 1000
      });
      seen.add(match.signal_id);
    }
  }

  return clusters;
};

const findDuplicatesJs = (
  signals: EmbeddedSignal[],
  threshold: number
): DuplicateCluster[] => {
  const clusters: DuplicateCluster[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < signals.length; i++) {
    if (seen.has(signals[i]!.signal_id)) continue;
    for (let j = i + 1; j < signals.length; j++) {
      if (seen.has(signals[j]!.signal_id)) continue;
      if (signals[i]!.source === signals[j]!.source) continue;
      const sim = cosineSimilarity(signals[i]!.embedding, signals[j]!.embedding);
      if (sim >= threshold) {
        clusters.push({
          signals: [signals[i]!.signal_id, signals[j]!.signal_id],
          similarity: Math.round(sim * 1000) / 1000
        });
        seen.add(signals[j]!.signal_id);
      }
    }
  }

  return clusters;
};
