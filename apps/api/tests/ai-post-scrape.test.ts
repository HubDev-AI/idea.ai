import { describe, expect, it } from 'vitest';
import {
  analyzePostScrapeBatchWithAi,
  parseAiPostScrapeInsights,
  resolveAiPostScrapeSettings
} from '../src/jobs/ai_post_scrape';

describe('ai post-scrape analysis', () => {
  it('parses valid AI payload into normalized insights', () => {
    const raw = `noise
{"signals":[
  {"id":"github_issues:1","idea":"Agentic support inbox","demand":84.6,"timing":77.2,"virality":60,"judge_scores":[61.1,64.5,68.9],"confidence":1.7,"is_noise":false,"rationale":"Teams repeatedly report support backlog and manual triage."},
  {"id":"github_issues:2","is_noise":true}
]}
tail`;

    const parsed = parseAiPostScrapeInsights(raw);
    expect(parsed.size).toBe(2);
    expect(parsed.get('github_issues:1')).toEqual({
      id: 'github_issues:1',
      idea: 'Agentic support inbox',
      demand: 85,
      timing: 77,
      virality: 60,
      judgeScores: [61, 65, 69],
      confidence: 1,
      isNoise: false,
      rationale: 'Teams repeatedly report support backlog and manual triage.'
    });
    expect(parsed.get('github_issues:2')).toEqual({
      id: 'github_issues:2',
      idea: undefined,
      demand: undefined,
      timing: undefined,
      virality: undefined,
      judgeScores: undefined,
      confidence: undefined,
      isNoise: true,
      rationale: undefined
    });
  });

  it('analyzes a batch via AI runner and falls back gracefully', async () => {
    const settings = resolveAiPostScrapeSettings({
      NODE_ENV: 'development',
      AI_PRIMARY: 'codex',
      AI_POST_SCRAPE_MAX_SIGNALS: '4'
    });

    const success = await analyzePostScrapeBatchWithAi({
      settings,
      inputs: [
        {
          id: 'github_issues:1',
          source: 'github_issues',
          topic: 'support',
          ideaDraft: 'draft',
          text: 'users report manual backlog and outage pain'
        }
      ],
      run: async () => ({
        provider: 'codex',
        text: '{"signals":[{"id":"github_issues:1","idea":"Support triage autopilot","demand":80,"timing":72,"virality":45,"judge_scores":[58,62,67]}]}',
        meta: {}
      })
    });

    expect(success.fromAi).toBe(true);
    expect(success.provider).toBe('codex');
    expect(success.insights.get('github_issues:1')?.idea).toBe('Support triage autopilot');

    const disabled = await analyzePostScrapeBatchWithAi({
      settings: { ...settings, enabled: false },
      inputs: [
        {
          id: 'github_issues:2',
          source: 'github_issues',
          topic: 'support',
          ideaDraft: 'draft',
          text: 'manual support queue'
        }
      ]
    });

    expect(disabled.attempted).toBe(false);
    expect(disabled.insights.size).toBe(0);
  });

  it('parses codex response wrapped in markdown fences', () => {
    const raw = '```json\n{"signals":[{"id":"hn:42","idea":"AI code review bot","demand":70,"timing":65,"virality":55,"judge_scores":[55,60,58],"confidence":0.8,"is_noise":false,"rationale":"Rising demand for automated code review."}]}\n```';

    const parsed = parseAiPostScrapeInsights(raw);
    expect(parsed.size).toBe(1);
    expect(parsed.get('hn:42')?.idea).toBe('AI code review bot');
    expect(parsed.get('hn:42')?.demand).toBe(70);
  });
});
