import { describe, expect, it, vi } from 'vitest';
import {
  buildAgentPrompt,
  parseAgentResponse,
  type AgentContext,
  type AgentOutput
} from '../src/jobs/research_agent';

describe('research agent', () => {
  describe('buildAgentPrompt', () => {
    it('includes active theses and recent signals in context', () => {
      const ctx: AgentContext = {
        activeTheses: [
          { canonicalKey: 'compliance:soc2', title: 'SOC2 copilot', confidence: 72, status: 'watching', evidenceCount: 8 }
        ],
        recentSignals: [
          { signal_id: 'sig-1', text: 'SOC2 audit took us 3 months', source: 'hn', pain: 85, timing: 70 }
        ],
        trendSummary: [
          { topic: 'compliance', window: '7d', count: 12, avg_pain: 75, growth: '+40%' }
        ]
      };

      const prompt = buildAgentPrompt(ctx);
      expect(prompt).toContain('SOC2 copilot');
      expect(prompt).toContain('sig-1');
      expect(prompt).toContain('compliance');
    });
  });

  describe('parseAgentResponse', () => {
    it('parses valid JSON response with thesis updates', () => {
      const raw = JSON.stringify({
        theses_updated: [
          { canonicalKey: 'compliance:soc2', confidence_delta: +5, reasoning: 'new evidence' }
        ],
        new_theses: [],
        alerts: [],
        investigate_next: 'AI billing patterns'
      });

      const result = parseAgentResponse(raw);
      expect(result).not.toBeNull();
      expect(result!.theses_updated).toHaveLength(1);
      expect(result!.investigate_next).toBe('AI billing patterns');
    });

    it('returns null on invalid JSON', () => {
      expect(parseAgentResponse('not json')).toBeNull();
    });
  });
});
