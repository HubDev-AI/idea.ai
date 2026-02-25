import { describe, expect, it, vi } from 'vitest';
import { runResearchAgent } from '../src/jobs/agent_runner';
import { InMemoryThesisStore } from '../src/runtime/thesis_store';

describe('agent runner', () => {
  it('updates thesis confidence based on agent output', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'compliance:soc2', title: 'SOC2 copilot', topic: 'compliance',
      status: 'watching', confidence: 72, scoreTotal: 72,
      problemStatement: 'p', targetBuyer: 'b', proposedSolution: 's',
      evidenceCount: 5, avgPain: 70, avgTiming: 60, avgBuildability: 65,
      latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    });

    const agentOutput = {
      theses_updated: [{ canonicalKey: 'compliance:soc2', confidence_delta: 10, reasoning: 'new evidence' }],
      new_theses: [],
      alerts: [],
      investigate_next: 'billing patterns'
    };

    const result = await runResearchAgent({
      thesisStore: store,
      runClaude: vi.fn().mockResolvedValue({
        text: JSON.stringify(agentOutput),
        provider: 'claude',
        meta: {}
      }),
      runCodex: vi.fn().mockRejectedValue(new Error('unavailable'))
    });

    expect(result.thesesUpdated).toBe(1);
    expect(result.investigateNext).toBe('billing patterns');

    const updated = await store.getByKey('compliance:soc2');
    expect(updated?.confidence).toBe(82);
    expect(updated?.status).toBe('promoted'); // crossed 80% threshold
  });

  it('creates new thesis candidates from agent proposals', async () => {
    const store = new InMemoryThesisStore();
    const agentOutput = {
      theses_updated: [],
      new_theses: [{
        title: 'AI Billing Copilot',
        problem_statement: 'Billing reconciliation is painful',
        target_buyer: 'Finance teams',
        proposed_solution: 'Automated reconciliation',
        supporting_signal_ids: ['sig-1', 'sig-2']
      }],
      alerts: [],
      investigate_next: ''
    };

    const result = await runResearchAgent({
      thesisStore: store,
      runClaude: vi.fn().mockResolvedValue({
        text: JSON.stringify(agentOutput),
        provider: 'claude',
        meta: {}
      }),
      runCodex: vi.fn().mockRejectedValue(new Error('unavailable'))
    });

    expect(result.newCandidates).toBe(1);
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('AI Billing Copilot');
    expect(all[0].status).toBe('candidate');
  });

  it('returns empty result when both providers fail', async () => {
    const store = new InMemoryThesisStore();
    const result = await runResearchAgent({
      thesisStore: store,
      runClaude: vi.fn().mockRejectedValue(new Error('down')),
      runCodex: vi.fn().mockRejectedValue(new Error('down'))
    });

    expect(result.thesesUpdated).toBe(0);
    expect(result.newCandidates).toBe(0);
  });
});
