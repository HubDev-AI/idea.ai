export type EmbeddedSignal = {
  signal_id: string;
  source: string;
  embedding: number[];
};

export type DuplicateCluster = {
  signals: string[];
  similarity: number;
};

const cosineSimilarity = (a: number[], b: number[]): number => {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
};

export const findDuplicates = (
  signals: EmbeddedSignal[],
  options: { threshold?: number } = {}
): DuplicateCluster[] => {
  const threshold = options.threshold ?? 0.92;
  const clusters: DuplicateCluster[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < signals.length; i++) {
    if (seen.has(signals[i].signal_id)) continue;

    for (let j = i + 1; j < signals.length; j++) {
      if (seen.has(signals[j].signal_id)) continue;
      if (signals[i].source === signals[j].source) continue;

      const sim = cosineSimilarity(signals[i].embedding, signals[j].embedding);
      if (sim >= threshold) {
        clusters.push({
          signals: [signals[i].signal_id, signals[j].signal_id],
          similarity: Math.round(sim * 1000) / 1000
        });
        seen.add(signals[j].signal_id);
      }
    }
  }

  return clusters;
};
