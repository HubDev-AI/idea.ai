export type SourceCategory = 'developer' | 'market' | 'academic' | 'enterprise' | 'consumer' | 'other';

const SOURCE_TO_CATEGORY: Record<string, SourceCategory> = {
  github_issues: 'developer',
  hacker_news: 'developer',
  hn: 'developer',
  stackoverflow: 'developer',
  npm_trends: 'developer',
  lobsters: 'developer',
  devto: 'developer',
  showhn: 'developer',
  homebrew: 'developer',
  producthunt: 'market',
  appstore_trending: 'market',
  yc_companies: 'market',
  alternativeto: 'market',
  google_trends: 'market',
  semantic_scholar: 'academic',
  g2_reviews: 'enterprise',
  greenhouse: 'enterprise',
  lever: 'enterprise',
  reddit: 'consumer',
  indiehackers: 'consumer',
  mastodon: 'consumer',
  bluesky: 'consumer',
  tiktok_creative: 'consumer',
};

const TOTAL_CATEGORIES = 5;

export const sourceCategory = (source: string): SourceCategory =>
  SOURCE_TO_CATEGORY[source] ?? 'other';

export const uniqueSourceCategories = (sources: string[]): Set<SourceCategory> => {
  const categories = new Set<SourceCategory>();
  for (const source of sources) {
    const cat = sourceCategory(source);
    if (cat !== 'other') categories.add(cat);
  }
  return categories;
};

export const corroborationScore = (sources: string[]): number => {
  if (sources.length === 0) return 0;
  const categories = uniqueSourceCategories(sources);
  return Math.round((categories.size / TOTAL_CATEGORIES) * 100) / 100;
};
