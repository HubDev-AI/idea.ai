import { describe, expect, it } from 'vitest';
import { scoreSignalWithAiFallback } from '../src/jobs/score';

describe('pipeline wiring', () => {
  it('falls back to keyword scoring when no AI provider available', async () => {
    const result = await scoreSignalWithAiFallback({
      text: 'SOC2 compliance is painful and urgent',
      source: 'hn',
      topic: 'compliance',
      judgeScores: [70, 65, 60],
      canonicalText: 'soc2 compliance is painful'
    });

    expect(result.pain).toBeGreaterThan(0);
    expect(result.timing).toBeGreaterThan(0);
    expect(result.aiScored).toBe(false);
  });
});
