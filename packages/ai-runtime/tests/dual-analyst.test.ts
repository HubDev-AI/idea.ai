import { describe, expect, it, vi } from 'vitest';
import { dualAnalystRun, reconcileScores } from '../src/dual_analyst';

describe('dual analyst', () => {
  describe('reconcileScores', () => {
    it('uses median when both providers return scores', () => {
      const result = reconcileScores(
        { demand: 80, timing: 60, buildability: 70, virality: 50 },
        { demand: 70, timing: 80, buildability: 60, virality: 60 }
      );
      expect(result.demand).toBe(75);
      expect(result.timing).toBe(70);
      expect(result.buildability).toBe(65);
      expect(result.virality).toBe(55);
      expect(result.agreement).toBe('aligned');
    });

    it('flags disagreement when scores differ by >25 on any dimension', () => {
      const result = reconcileScores(
        { demand: 90, timing: 60, buildability: 70, virality: 80 },
        { demand: 50, timing: 55, buildability: 65, virality: 75 }
      );
      expect(result.agreement).toBe('contested');
      expect(result.contestedDimensions).toContain('demand');
    });

    it('uses single provider when only one returns', () => {
      const result = reconcileScores(
        { demand: 80, timing: 60, buildability: 70, virality: 55 },
        null
      );
      expect(result.demand).toBe(80);
      expect(result.agreement).toBe('single');
    });
  });

  describe('dualAnalystRun', () => {
    it('calls both providers and reconciles', async () => {
      const runClaude = vi.fn().mockResolvedValue({
        text: JSON.stringify({ demand: 80, timing: 60, buildability: 70, virality: 50, reasoning: 'claude' }),
        provider: 'claude', meta: {}
      });
      const runCodex = vi.fn().mockResolvedValue({
        text: JSON.stringify({ demand: 75, timing: 65, buildability: 72, virality: 55, reasoning: 'codex' }),
        provider: 'codex', meta: {}
      });

      const result = await dualAnalystRun(
        { prompt: 'test', timeoutMs: 10_000 },
        { runClaude, runCodex, parseResponse: JSON.parse }
      );

      expect(result.claude).not.toBeNull();
      expect(result.codex).not.toBeNull();
      expect(runClaude).toHaveBeenCalledOnce();
      expect(runCodex).toHaveBeenCalledOnce();
    });

    it('handles single provider failure gracefully', async () => {
      const runClaude = vi.fn().mockResolvedValue({
        text: JSON.stringify({ demand: 80, timing: 60, buildability: 70, virality: 50, reasoning: 'ok' }),
        provider: 'claude', meta: {}
      });
      const runCodex = vi.fn().mockRejectedValue(new Error('codex down'));

      const result = await dualAnalystRun(
        { prompt: 'test', timeoutMs: 10_000 },
        { runClaude, runCodex, parseResponse: JSON.parse }
      );

      expect(result.claude).not.toBeNull();
      expect(result.codex).toBeNull();
    });
  });
});
