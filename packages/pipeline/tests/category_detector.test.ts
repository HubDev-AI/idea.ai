import { describe, expect, it } from 'vitest';
import {
  detectVocabularyEmergence,
  computeToolFragmentation,
  computeInvestorAttention,
  categoryCreationScore,
} from '../src/scoring/category_detector';

describe('detectVocabularyEmergence', () => {
  it('flags phrases appearing in current window but not baseline', () => {
    const baseline = ['react hooks are great', 'typescript generics help', 'graphql resolvers work'];
    const current = ['vibe coding is new', 'vibe coding rocks', 'vibe coding with AI', 'react hooks still great'];
    const result = detectVocabularyEmergence(baseline, current, { minCount: 2 });
    expect(result.emergingPhrases).toContain('vibe coding');
    expect(result.score).toBeGreaterThan(0);
  });

  it('returns 0 for identical sets', () => {
    const texts = ['react hooks are great', 'typescript generics help'];
    const result = detectVocabularyEmergence(texts, texts);
    expect(result.score).toBe(0);
    expect(result.emergingPhrases).toEqual([]);
  });
});

describe('computeToolFragmentation', () => {
  it('high fragmentation = many tools, no dominant player', () => {
    const tools = Array.from({ length: 15 }, (_, i) => ({
      id: `tool-${i}`,
      engagement: 100 + Math.random() * 50,
    }));
    const result = computeToolFragmentation(tools);
    expect(result.score).toBeGreaterThan(50);
    expect(result.isFragmented).toBe(true);
  });

  it('low fragmentation = one dominant tool', () => {
    const tools = [
      { id: 'dominant', engagement: 10000 },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `small-${i}`, engagement: 10 })),
    ];
    const result = computeToolFragmentation(tools);
    expect(result.isFragmented).toBe(false);
  });

  it('returns 0 for empty input', () => {
    expect(computeToolFragmentation([]).score).toBe(0);
  });
});

describe('computeInvestorAttention', () => {
  it('high attention from multiple VC sources', () => {
    const signals = [
      { source: 'yc_companies', count: 3 },
      { source: 'producthunt', count: 5 },
      { source: 'crunchbase', count: 2 },
    ];
    const result = computeInvestorAttention(signals);
    expect(result.score).toBeGreaterThan(50);
  });

  it('zero for no signals', () => {
    expect(computeInvestorAttention([]).score).toBe(0);
  });
});

describe('categoryCreationScore', () => {
  it('blends three sub-scores with weights', () => {
    const score = categoryCreationScore({
      vocabularyScore: 80,
      fragmentationScore: 60,
      investorScore: 40,
    });
    expect(score).toBe(60);
  });

  it('clamps to 0-100', () => {
    expect(categoryCreationScore({ vocabularyScore: 0, fragmentationScore: 0, investorScore: 0 })).toBe(0);
    expect(categoryCreationScore({ vocabularyScore: 100, fragmentationScore: 100, investorScore: 100 })).toBe(100);
  });
});
