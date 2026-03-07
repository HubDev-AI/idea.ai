import { describe, expect, it } from 'vitest';
import {
  corroborationScore,
  sourceCategory,
  uniqueSourceCategories,
} from '../src/scoring/correlation';

describe('sourceCategory', () => {
  it('maps github_issues to developer', () => {
    expect(sourceCategory('github_issues')).toBe('developer');
  });

  it('maps producthunt to market', () => {
    expect(sourceCategory('producthunt')).toBe('market');
  });

  it('maps unknown sources to other', () => {
    expect(sourceCategory('unknown_source')).toBe('other');
  });
});

describe('uniqueSourceCategories', () => {
  it('counts unique categories from source list', () => {
    const categories = uniqueSourceCategories(['github_issues', 'hacker_news', 'reddit', 'producthunt']);
    expect(categories.size).toBe(3);
  });

  it('deduplicates same-category sources', () => {
    const categories = uniqueSourceCategories(['github_issues', 'hacker_news', 'stackoverflow']);
    expect(categories.size).toBe(1);
  });
});

describe('corroborationScore', () => {
  it('returns 0 for empty sources', () => {
    expect(corroborationScore([])).toBe(0);
  });

  it('returns higher score for more diverse sources', () => {
    const single = corroborationScore(['github_issues']);
    const diverse = corroborationScore(['github_issues', 'producthunt', 'g2_reviews', 'reddit']);
    expect(diverse).toBeGreaterThan(single);
  });

  it('returns 1.0 for all categories represented', () => {
    const all = corroborationScore([
      'github_issues',
      'producthunt',
      'semantic_scholar',
      'g2_reviews',
      'reddit',
    ]);
    expect(all).toBe(1);
  });
});
