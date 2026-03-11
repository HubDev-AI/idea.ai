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
    it('calls preferred provider first and skips fallback on success', async () => {
      const runClaude = vi.fn().mockResolvedValue({
        text: JSON.stringify({ demand: 80, timing: 60, buildability: 70, virality: 50 }),
        provider: 'claude', meta: {}
      });
      const runCodex = vi.fn().mockResolvedValue({
        text: JSON.stringify({ demand: 75, timing: 65, buildability: 72, virality: 55 }),
        provider: 'codex', meta: {}
      });

      const result = await dualAnalystRun(
        { prompt: 'test', timeoutMs: 10_000 },
        { runClaude, runCodex, parseResponse: JSON.parse }
      );

      expect(runClaude).toHaveBeenCalledOnce();
      expect(runCodex).not.toHaveBeenCalled();
      expect(result.claude).not.toBeNull();
      expect(result.codex).toBeNull();
    });

    it('falls back to other provider on primary failure', async () => {
      const runClaude = vi.fn().mockRejectedValue(new Error('claude down'));
      const runCodex = vi.fn().mockResolvedValue({
        text: JSON.stringify({ demand: 80, timing: 60, buildability: 70, virality: 50 }),
        provider: 'codex', meta: {}
      });

      const result = await dualAnalystRun(
        { prompt: 'test', timeoutMs: 10_000 },
        { runClaude, runCodex, parseResponse: JSON.parse }
      );

      expect(result.claude).toBeNull();
      expect(result.codex).not.toBeNull();
    });

    it('falls back when primary returns unparseable response', async () => {
      const runClaude = vi.fn().mockResolvedValue({
        text: 'not json', provider: 'claude', meta: {}
      });
      const runCodex = vi.fn().mockResolvedValue({
        text: JSON.stringify({ value: 2 }), provider: 'codex', meta: {}
      });

      const result = await dualAnalystRun(
        { prompt: 'test', timeoutMs: 10_000 },
        { runClaude, runCodex, parseResponse: JSON.parse }
      );

      expect(result.claude).toBeNull();
      expect(result.codex).toEqual({ value: 2 });
    });

    it('throws and logs ai_provider when no provider returns a usable response', async () => {
      const warn = vi.fn().mockResolvedValue(undefined);

      await expect(dualAnalystRun(
        { prompt: 'test', timeoutMs: 10_000 },
        {
          runClaude: vi.fn().mockRejectedValue(new Error('claude down')),
          runCodex: vi.fn().mockResolvedValue({
            text: 'still not json',
            provider: 'codex',
            meta: {}
          }),
          parseResponse: JSON.parse,
          logger: { info: vi.fn().mockResolvedValue(undefined), warn },
          preferred: 'codex',
        }
      )).rejects.toThrow(/No AI provider returned a usable response/i);

      expect(warn).toHaveBeenCalledWith(
        'ai_provider',
        'codex failed',
        expect.objectContaining({
          strategy: 'primary_with_fallback',
          preferred: 'codex',
        })
      );
    });

    it('does not retry when retry budget is zero', async () => {
      const runClaude = vi.fn().mockRejectedValue(new Error('claude down'));
      const runCodex = vi.fn().mockRejectedValue(new Error('codex down'));

      await expect(dualAnalystRun(
        { prompt: 'test', timeoutMs: 10_000 },
        {
          runClaude,
          runCodex,
          parseResponse: JSON.parse,
          retries: 0,
        }
      )).rejects.toThrow(/No AI provider returned a usable response/i);

      expect(runClaude).toHaveBeenCalledTimes(1);
      expect(runCodex).toHaveBeenCalledTimes(1);
    });

    it('retries the current provider up to the configured budget', async () => {
      const runClaude = vi.fn()
        .mockRejectedValueOnce(new Error('first'))
        .mockRejectedValueOnce(new Error('second'))
        .mockResolvedValueOnce({
          text: JSON.stringify({ value: 3 }),
          provider: 'claude',
          meta: {}
        });

      const result = await dualAnalystRun(
        { prompt: 'test', timeoutMs: 10_000 },
        {
          runClaude,
          runCodex: vi.fn(),
          parseResponse: JSON.parse,
          allowFallback: false,
          retries: 2,
        }
      );

      expect(runClaude).toHaveBeenCalledTimes(3);
      expect(result.claude).toEqual({ value: 3 });
    });
  });
});
