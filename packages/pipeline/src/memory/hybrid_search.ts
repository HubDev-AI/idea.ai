export type RankedResult = {
  signal_id: string;
  rank: number;
};

export type MergedResult = {
  signal_id: string;
  rrf_score: number;
};

export const mergeByRRF = (
  vectorResults: RankedResult[],
  textResults: RankedResult[],
  options: { k?: number; topN?: number } = {}
): MergedResult[] => {
  const k = options.k ?? 60;
  const scores = new Map<string, number>();

  for (const r of vectorResults) {
    scores.set(r.signal_id, (scores.get(r.signal_id) ?? 0) + 1 / (k + r.rank));
  }

  for (const r of textResults) {
    scores.set(r.signal_id, (scores.get(r.signal_id) ?? 0) + 1 / (k + r.rank));
  }

  const merged = Array.from(scores.entries())
    .map(([signal_id, rrf_score]) => ({ signal_id, rrf_score }))
    .sort((a, b) => b.rrf_score - a.rrf_score);

  return options.topN ? merged.slice(0, options.topN) : merged;
};
