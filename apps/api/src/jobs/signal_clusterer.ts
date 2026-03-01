export type ClusterableSignal = {
  signal_id: string;
  canonical_text: string;
  source: string;
  demand: number;
  timing: number;
  virality?: number;
  blended: number;
  embedding: number[];
};

export type SignalCluster = {
  id: number;
  label: string;
  totalCount: number;
  representatives: ClusterableSignal[];
  avgDemand: number;
  avgTiming: number;
  sources: string[];
};

export type ClusterOptions = {
  distanceThreshold?: number;    // cosine distance threshold (default 0.35)
  maxRepresentatives?: number;   // per cluster (default 3)
  maxTotalRepresentatives?: number; // cap across all clusters (default 120)
  minBlended?: number;           // filter out low-quality signals (default 30)
};

const cosineDistance = (a: number[], b: number[]): number => {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    magA += (a[i] ?? 0) ** 2;
    magB += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
};

export const clusterSignals = (
  signals: ClusterableSignal[],
  options: ClusterOptions = {}
): SignalCluster[] => {
  const {
    distanceThreshold = 0.35,
    maxRepresentatives = 3,
    maxTotalRepresentatives = 120,
    minBlended = 30
  } = options;

  // Filter and sort by blended score descending
  const filtered = signals
    .filter((s) => s.blended >= minBlended)
    .sort((a, b) => b.blended - a.blended);

  if (filtered.length === 0) return [];

  const assigned = new Set<string>();
  const clusters: SignalCluster[] = [];

  for (const seed of filtered) {
    if (assigned.has(seed.signal_id)) continue;

    const members: ClusterableSignal[] = [seed];
    assigned.add(seed.signal_id);

    for (const candidate of filtered) {
      if (assigned.has(candidate.signal_id)) continue;
      if (cosineDistance(seed.embedding, candidate.embedding) < distanceThreshold) {
        members.push(candidate);
        assigned.add(candidate.signal_id);
      }
    }

    // Pick top representatives by blended score (already sorted)
    const representatives = members.slice(0, maxRepresentatives);
    const sources = [...new Set(members.map((m) => m.source))];
    const avgDemand = members.reduce((sum, m) => sum + m.demand, 0) / members.length;
    const avgTiming = members.reduce((sum, m) => sum + m.timing, 0) / members.length;

    // Derive label from most common topic-like content
    const label = representatives[0]?.canonical_text.split(' | ')[0]?.slice(0, 60) ?? 'unknown';

    clusters.push({
      id: clusters.length,
      label,
      totalCount: members.length,
      representatives,
      avgDemand: Math.round(avgDemand * 100) / 100,
      avgTiming: Math.round(avgTiming * 100) / 100,
      sources
    });
  }

  // Cap total representatives across all clusters
  let totalReps = 0;
  const capped: SignalCluster[] = [];
  for (const cluster of clusters) {
    const remaining = maxTotalRepresentatives - totalReps;
    if (remaining <= 0) break;
    const reps = cluster.representatives.slice(0, remaining);
    capped.push({ ...cluster, representatives: reps });
    totalReps += reps.length;
  }

  return capped;
};
