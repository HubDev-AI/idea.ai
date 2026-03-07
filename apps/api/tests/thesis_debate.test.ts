import { describe, expect, it, vi } from 'vitest';
import {
  runDebate,
  parseModeratorVerdict,
  verdictToLikelihoodRatio,
  BULL_SYSTEM,
  BEAR_SYSTEM,
  MODERATOR_SYSTEM,
  type DebateResult,
  type ModeratorVerdict,
} from '../src/jobs/thesis_debate';

describe('parseModeratorVerdict', () => {
  it('parses valid JSON verdict', () => {
    const raw = JSON.stringify({
      confidence: 0.7,
      bull_strength: 80,
      bear_strength: 40,
      missing_evidence: ['market size data'],
      verdict: 'strong_opportunity',
    });
    const result = parseModeratorVerdict(raw);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('strong_opportunity');
    expect(result!.confidence).toBe(0.7);
  });

  it('parses markdown-wrapped JSON', () => {
    const raw = '```json\n{"confidence":0.5,"bull_strength":60,"bear_strength":55,"missing_evidence":[],"verdict":"contested"}\n```';
    const result = parseModeratorVerdict(raw);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('contested');
  });

  it('returns null for invalid input', () => {
    expect(parseModeratorVerdict('not json at all')).toBeNull();
  });

  it('returns null for missing verdict field', () => {
    expect(parseModeratorVerdict('{"confidence": 0.5}')).toBeNull();
  });
});

describe('verdictToLikelihoodRatio', () => {
  it('strong_opportunity returns 2.5', () => {
    expect(verdictToLikelihoodRatio('strong_opportunity')).toBe(2.5);
  });
  it('needs_investigation returns 1.3', () => {
    expect(verdictToLikelihoodRatio('needs_investigation')).toBe(1.3);
  });
  it('contested returns 0.8', () => {
    expect(verdictToLikelihoodRatio('contested')).toBe(0.8);
  });
  it('likely_noise returns 0.3', () => {
    expect(verdictToLikelihoodRatio('likely_noise')).toBe(0.3);
  });
});

describe('runDebate', () => {
  it('orchestrates bull then bear then moderator sequentially', async () => {
    const callOrder: string[] = [];
    const mockRun = (label: string) => async (input: { prompt: string }) => {
      callOrder.push(label);
      if (label.includes('moderator')) {
        return {
          text: JSON.stringify({
            confidence: 0.6, bull_strength: 70, bear_strength: 50,
            missing_evidence: [], verdict: 'needs_investigation',
          }),
          provider: 'claude' as const,
          meta: {},
        };
      }
      return { text: `${label} argument for the thesis`, provider: 'claude' as const, meta: {} };
    };

    const result = await runDebate({
      thesisTitle: 'Test Thesis',
      thesisKey: 'test:key',
      problemStatement: 'A test problem',
      evidence: ['signal 1', 'signal 2'],
      runBull: mockRun('bull'),
      runBear: mockRun('bear'),
      runModerator: mockRun('moderator'),
    });

    expect(result).not.toBeNull();
    expect(callOrder).toEqual(['bull', 'bear', 'moderator']);
    expect(result!.verdict.verdict).toBe('needs_investigation');
    expect(result!.bullCase).toContain('bull argument');
    expect(result!.bearCase).toContain('bear argument');
  });

  it('returns null if moderator fails to parse', async () => {
    const mockRun = async () => ({ text: 'garbage', provider: 'claude' as const, meta: {} });
    const result = await runDebate({
      thesisTitle: 'Test', thesisKey: 'k', problemStatement: 'p', evidence: [],
      runBull: mockRun, runBear: mockRun, runModerator: mockRun,
    });
    expect(result).toBeNull();
  });
});

describe('system prompts exist', () => {
  it('has all three system prompts', () => {
    expect(BULL_SYSTEM.length).toBeGreaterThan(50);
    expect(BEAR_SYSTEM.length).toBeGreaterThan(50);
    expect(MODERATOR_SYSTEM.length).toBeGreaterThan(50);
  });
});
