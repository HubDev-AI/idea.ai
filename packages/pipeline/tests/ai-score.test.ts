import { describe, expect, it, vi } from 'vitest';
import { aiScoreSignal, parseAiScoreResponse } from '../src/scoring/ai_score';

describe('AI signal scoring', () => {
  describe('parseAiScoreResponse', () => {
    it('parses valid JSON with demand, timing, buildability, reasoning', () => {
      const raw = JSON.stringify({
        demand: 75,
        timing: 60,
        buildability: 80,
        reasoning: 'Recurring SOC2 burden with no good SaaS solution'
      });
      const result = parseAiScoreResponse(raw);
      expect(result).toEqual({
        demand: 75,
        timing: 60,
        buildability: 80,
        reasoning: 'Recurring SOC2 burden with no good SaaS solution'
      });
    });

    it('clamps scores to 0-100', () => {
      const raw = JSON.stringify({ demand: 120, timing: -5, buildability: 50, reasoning: 'test' });
      const result = parseAiScoreResponse(raw);
      expect(result!.demand).toBe(100);
      expect(result!.timing).toBe(0);
    });

    it('supports legacy pain field name', () => {
      const raw = JSON.stringify({ pain: 75, timing: 60, buildability: 80, reasoning: 'legacy' });
      const result = parseAiScoreResponse(raw);
      expect(result!.demand).toBe(75);
    });

    it('returns null on unparseable input', () => {
      expect(parseAiScoreResponse('garbage')).toBeNull();
    });
  });

  describe('aiScoreSignal', () => {
    it('sends structured prompt and returns parsed scores', async () => {
      const mockRunPrompt = vi.fn().mockResolvedValue({
        text: JSON.stringify({ demand: 80, timing: 65, buildability: 70, reasoning: 'Clear demand in compliance' }),
        provider: 'claude',
        meta: {}
      });

      const result = await aiScoreSignal(
        { text: 'SOC2 auditing is manual and painful', source: 'hn', topic: 'compliance' },
        { runPrompt: mockRunPrompt }
      );

      expect(result).not.toBeNull();
      expect(result!.demand).toBe(80);
      expect(result!.timing).toBe(65);
      expect(result!.buildability).toBe(70);
    });

    it('returns null when AI fails', async () => {
      const mockRunPrompt = vi.fn().mockRejectedValue(new Error('timeout'));
      const result = await aiScoreSignal(
        { text: 'test', source: 'hn', topic: 'test' },
        { runPrompt: mockRunPrompt }
      );
      expect(result).toBeNull();
    });
  });
});
