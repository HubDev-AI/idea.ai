import { describe, expect, it, vi } from 'vitest';
import { classifyBatch, parseNoiseGateResponse } from '../src/scoring/noise_gate';

describe('noise gate', () => {
  describe('parseNoiseGateResponse', () => {
    it('parses valid JSON array of classifications', () => {
      const raw = JSON.stringify([
        { id: 'sig-1', classification: 'strong' },
        { id: 'sig-2', classification: 'noise' },
        { id: 'sig-3', classification: 'weak' }
      ]);
      const result = parseNoiseGateResponse(raw);
      expect(result).toEqual([
        { id: 'sig-1', classification: 'strong' },
        { id: 'sig-2', classification: 'noise' },
        { id: 'sig-3', classification: 'weak' }
      ]);
    });

    it('returns all weak on unparseable input', () => {
      const result = parseNoiseGateResponse('garbage', ['a', 'b']);
      expect(result).toEqual([
        { id: 'a', classification: 'weak' },
        { id: 'b', classification: 'weak' }
      ]);
    });
  });

  describe('classifyBatch', () => {
    it('calls AI provider with batch prompt and returns classifications', async () => {
      const mockRunPrompt = vi.fn().mockResolvedValue({
        text: JSON.stringify([
          { id: 'sig-1', classification: 'strong' },
          { id: 'sig-2', classification: 'noise' }
        ]),
        provider: 'claude',
        meta: {}
      });

      const signals = [
        { id: 'sig-1', text: 'SOC2 compliance is killing our team' },
        { id: 'sig-2', text: 'Check out my new portfolio website' }
      ];

      const result = await classifyBatch(signals, { runPrompt: mockRunPrompt });

      expect(result).toHaveLength(2);
      expect(result[0].classification).toBe('strong');
      expect(result[1].classification).toBe('noise');
      expect(mockRunPrompt).toHaveBeenCalledOnce();
    });
  });
});
