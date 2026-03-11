import { describe, expect, it } from 'vitest';
import { buildBroadScanPrompt } from '../src/jobs/research_agent';
import { b2bProfile } from '../src/profiles/b2b';
import { consumerProfile } from '../src/profiles/consumer';

describe('research agent prompt builder', () => {
  it('keeps consumer viral-distribution guidance for the consumer profile', () => {
    const prompt = buildBroadScanPrompt({
      activeTheses: [],
      clusters: [],
      recentJournal: [],
      trendSummary: [],
    }, consumerProfile);

    expect(prompt).toContain('consumer/social app opportunity');
    expect(prompt).toContain('viral growth loop');
  });

  it('does not force consumer/social ideas for the b2b profile', () => {
    const prompt = buildBroadScanPrompt({
      activeTheses: [],
      clusters: [],
      recentJournal: [],
      trendSummary: [],
    }, b2bProfile);

    expect(prompt).not.toContain('consumer/social app opportunity');
    expect(prompt).not.toContain('Focus on concrete consumer product angles');
    expect(prompt).toContain('sales, partnerships, and word-of-mouth among professionals');
  });
});
