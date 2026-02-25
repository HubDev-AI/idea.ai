import { describe, expect, it, vi } from 'vitest';
import { dualAnalystRun, reconcileScores, type DualResult } from '../src/dual_analyst';

describe('dual analyst', () => {
  describe('reconcileScores', () => {
    it('uses median when both providers return scores', () => {
      const result = reconcileScores(
        { pain: 80, timing: 60, buildability: 70 },
        { pain: 70, timing: 80, buildability: 60 }
      );
      expect(result.pain).toBe(75);
      expect(result.timing).toBe(70);
      expect(result.buildability).toBe(65);
      expect(result.agreement).toBe('aligned');
    });

    it('flags disagreement when scores differ by >25 on any dimension', () => {
      const result = reconcileScores(
        { pain: 90, timing: 60, buildability: 70 },
        { pain: 50, timing: 55, buildability: 65 }
      );
      expect(result.agreement).toBe('contested');
      expect(result.contestedDimensions).toContain('pain');
    });

    it('uses single provider when only one returns', () => {
      const result = reconcileScores(
        { pain: 80, timing: 60, buildability: 70 },
        null
      );
      expect(result.pain).toBe(80);
      expect(result.agreement).toBe('single');
    });
  });

  describe('dualAnalystRun', () => {
    it('calls both providers and reconciles', async () => {
      const runClaude = vi.fn().mockResolvedValue({
        text: JSON.stringify({ pain: 80, timing: 60, buildability: 70, reasoning: 'claude' }),
        provider: 'claude', meta: {}
      });
      const runCodex = vi.fn().mockResolvedValue({
        text: JSON.stringify({ pain: 75, timing: 65, buildability: 72, reasoning: 'codex' }),
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
        text: JSON.stringify({ pain: 80, timing: 60, buildability: 70, reasoning: 'ok' }),
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
