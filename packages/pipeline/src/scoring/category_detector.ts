const extractBigrams = (text: string): string[] => {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3);
  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]} ${words[i + 1]}`);
  }
  return bigrams;
};

export const detectVocabularyEmergence = (
  baselineTexts: string[],
  currentTexts: string[],
  opts: { minCount?: number } = {}
): { emergingPhrases: string[]; score: number } => {
  const minCount = opts.minCount ?? 3;
  const baselinePhrases = new Set<string>();
  for (const text of baselineTexts) {
    for (const bg of extractBigrams(text)) baselinePhrases.add(bg);
  }

  const currentCounts = new Map<string, number>();
  for (const text of currentTexts) {
    for (const bg of extractBigrams(text)) {
      currentCounts.set(bg, (currentCounts.get(bg) ?? 0) + 1);
    }
  }

  const emerging: string[] = [];
  for (const [phrase, count] of currentCounts) {
    if (count >= minCount && !baselinePhrases.has(phrase)) {
      emerging.push(phrase);
    }
  }

  const score = Math.min(100, emerging.length * 20);
  return { emergingPhrases: emerging, score };
};

export const computeToolFragmentation = (
  tools: { id: string; engagement: number }[]
): { score: number; isFragmented: boolean; toolCount: number } => {
  if (tools.length === 0) return { score: 0, isFragmented: false, toolCount: 0 };

  const maxEngagement = Math.max(...tools.map(t => t.engagement));
  const avgEngagement = tools.reduce((s, t) => s + t.engagement, 0) / tools.length;

  const isFragmented = tools.length >= 10 && maxEngagement < 5 * avgEngagement;

  const countScore = Math.min(100, tools.length * 8);
  const evennessScore = maxEngagement < 3 * avgEngagement ? 100 : maxEngagement < 5 * avgEngagement ? 60 : 20;
  const score = Math.round(countScore * 0.5 + evennessScore * 0.5);

  return { score, isFragmented, toolCount: tools.length };
};

export const computeInvestorAttention = (
  signals: { source: string; count: number }[]
): { score: number; totalSignals: number } => {
  if (signals.length === 0) return { score: 0, totalSignals: 0 };

  const vcSources = new Set(['yc_companies', 'producthunt', 'crunchbase']);
  const total = signals.reduce((sum, s) => sum + s.count, 0);
  const vcSourceCount = signals.filter(s => vcSources.has(s.source) && s.count > 0).length;

  const volumeScore = Math.min(100, total * 10);
  const diversityScore = (vcSourceCount / 3) * 100;
  const score = Math.round(volumeScore * 0.5 + diversityScore * 0.5);

  return { score, totalSignals: total };
};

export const categoryCreationScore = (input: {
  vocabularyScore: number;
  fragmentationScore: number;
  investorScore: number;
}): number => {
  const raw = input.vocabularyScore * 0.3 + input.fragmentationScore * 0.4 + input.investorScore * 0.3;
  return Math.round(Math.max(0, Math.min(100, raw)));
};
