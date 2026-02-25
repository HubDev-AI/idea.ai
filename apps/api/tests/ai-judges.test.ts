import { describe, expect, it, vi } from 'vitest';
import {
  isAiJudgeEligible,
  judgeBuildabilityWithAi,
  parseJudgeScores,
  resolveAiJudgeSettings
} from '../src/jobs/ai_judges';

describe('ai judges', () => {
  it('parses strict JSON judge response', () => {
    const parsed = parseJudgeScores('{"judge_scores":[71,64,59]}');
    expect(parsed).toEqual([71, 64, 59]);
  });

  it('falls back to numeric extraction when response is not strict JSON', () => {
    const parsed = parseJudgeScores('judge scores => 70, 62, 58');
    expect(parsed).toEqual([70, 62, 58]);
  });

  it('returns fallback scores when AI call fails', async () => {
    const logger = {
      runId: 'test',
      filePath: '/tmp/test',
      debug: vi.fn(async () => {}),
      info: vi.fn(async () => {}),
      warn: vi.fn(async () => {}),
      error: vi.fn(async () => {})
    };

    const result = await judgeBuildabilityWithAi({
      idea: 'SOC2 automation assistant',
      text: 'Founders report repeated audit evidence pain',
      topic: 'compliance',
      source: 'github_issues',
      settings: {
        preferredProvider: 'claude',
        maxSignals: 8,
        timeoutMs: 1000,
        allowFallback: false,
        mode: 'single'
      },
      logger,
      run: async () => {
        throw new Error('provider unavailable');
      }
    });

    expect(result.fromAi).toBe(false);
    expect(result.judgeScores).toEqual([62, 66, 60]);
  });

  it('uses AI scores when provider returns parseable payload', async () => {
    const result = await judgeBuildabilityWithAi({
      idea: 'SOC2 automation assistant',
      text: 'Founders report repeated audit evidence pain',
      topic: 'compliance',
      source: 'github_issues',
      settings: {
        preferredProvider: 'claude',
        maxSignals: 8,
        timeoutMs: 1000,
        allowFallback: false,
        mode: 'single'
      },
      run: async () => ({
        text: '{"judge_scores":[72,65,61]}',
        provider: 'claude',
        meta: {}
      })
    });

    expect(result.fromAi).toBe(true);
    expect(result.judgeScores).toEqual([72, 65, 61]);
    expect(result.provider).toBe('claude');
  });

  it('defaults AI judge calls off in test environments', () => {
    const settings = resolveAiJudgeSettings({
      NODE_ENV: 'test'
    });

    expect(settings.maxSignals).toBe(0);
    expect(settings.allowFallback).toBe(false);
    expect(settings.mode).toBe('single');
  });

  it('keeps single mode unless ensemble is explicitly enabled', () => {
    const settings = resolveAiJudgeSettings({
      AI_PROVIDER: 'both',
      AI_PROVIDER_PRIMARY: 'codex',
      AI_JUDGE_MAX_SIGNALS: '3'
    });

    expect(settings.mode).toBe('single');
    expect(settings.preferredProvider).toBe('codex');
    expect(settings.maxSignals).toBe(3);
  });

  it('enables ensemble mode when AI_PROVIDER_MODE=ensemble', () => {
    const settings = resolveAiJudgeSettings({
      AI_PROVIDER: 'both',
      AI_PROVIDER_MODE: 'ensemble',
      AI_PROVIDER_PRIMARY: 'codex',
      AI_JUDGE_MAX_SIGNALS: '3'
    });

    expect(settings.mode).toBe('ensemble');
    expect(settings.preferredProvider).toBe('codex');
    expect(settings.maxSignals).toBe(3);
  });

  it('aggregates judge scores from both providers in ensemble mode', async () => {
    const result = await judgeBuildabilityWithAi({
      idea: 'SOC2 automation assistant',
      text: 'Founders report repeated audit evidence pain',
      topic: 'compliance',
      source: 'github_issues',
      settings: {
        preferredProvider: 'claude',
        maxSignals: 8,
        timeoutMs: 1000,
        allowFallback: false,
        mode: 'ensemble'
      },
      run: async (input) =>
        input.preferredProvider === 'claude'
          ? {
              text: '{"judge_scores":[68,64,61]}',
              provider: 'claude',
              meta: {}
            }
          : {
              text: '{"judge_scores":[74,66,59]}',
              provider: 'codex',
              meta: {}
            }
    });

    expect(result.fromAi).toBe(true);
    expect(result.judgeScores).toEqual([71, 65, 60]);
    expect(result.providers).toEqual(['claude', 'codex']);
  });

  it('only marks opportunity-like text as AI-eligible', () => {
    expect(isAiJudgeEligible('Founders struggle with manual billing error handling')).toBe(true);
    expect(isAiJudgeEligible('Account Executive role description and responsibilities')).toBe(false);
  });
});
