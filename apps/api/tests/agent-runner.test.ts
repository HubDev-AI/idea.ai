import { describe, expect, it, vi } from 'vitest';
import { runResearchAgent } from '../src/jobs/agent_runner';
import { InMemoryThesisStore } from '../src/runtime/thesis_store';

// Helper to create mock AI response
const mockAiResponse = (text: string) =>
  vi.fn().mockResolvedValue({ text, provider: 'claude', meta: {} });

const failingAi = () =>
  vi.fn().mockRejectedValue(new Error('unavailable'));

describe('agent runner', () => {
  it('updates thesis confidence based on agent output', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'compliance:soc2', title: 'SOC2 copilot', topic: 'compliance',
      status: 'watching', confidence: 72, scoreTotal: 72,
      problemStatement: 'p', targetBuyer: 'b', proposedSolution: 's',
      evidenceCount: 5, avgDemand: 70, avgTiming: 60, avgBuildability: 65, avgVirality: 30,
      latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    });

    // The new agent runner expects BroadScanOutput format
    const broadOutput = {
      thesis_updates: [{ canonicalKey: 'compliance:soc2', confidence_delta: 10, reasoning: 'new evidence' }],
      dig_deeper: [],
      observations: []
    };

    const result = await runResearchAgent({
      thesisStore: store,
      runClaude: mockAiResponse(JSON.stringify(broadOutput)),
      runCodex: failingAi()
    });

    expect(result.thesesUpdated).toBe(1);
    const updated = await store.getByKey('compliance:soc2');
    expect(updated?.confidence).toBe(82);
    expect(updated?.status).toBe('promoted');
  });

  it('returns empty result when both providers fail', async () => {
    const store = new InMemoryThesisStore();
    const result = await runResearchAgent({
      thesisStore: store,
      runClaude: failingAi(),
      runCodex: failingAi()
    });

    expect(result.thesesUpdated).toBe(0);
    expect(result.newCandidates).toBe(0);
    expect(result.deepDivesPerformed).toBe(0);
  });

  it('performs deep dive when broad scan suggests dig_deeper', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'billing:copilot', title: 'Billing Copilot', topic: 'billing',
      status: 'watching', confidence: 60, scoreTotal: 60,
      problemStatement: 'p', targetBuyer: 'b', proposedSolution: 's',
      evidenceCount: 3, avgDemand: 65, avgTiming: 55, avgBuildability: 60, avgVirality: 25,
      latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    });

    const broadOutput = {
      thesis_updates: [],
      dig_deeper: [{ topic: 'billing automation', reason: 'cluster growing fast', related_cluster_ids: [0] }],
      observations: [{ entry_type: 'emerging_pattern', topic: 'billing', insight: 'growing demand', narrative: 'details...' }]
    };

    const deepOutput = {
      thesis_updates: [{ canonicalKey: 'billing:copilot', confidence_delta: 15, reasoning: 'deep evidence' }],
      new_theses: [{
        title: 'Invoice AI',
        problem_statement: 'Manual invoice processing',
        target_buyer: 'Accounting teams',
        proposed_solution: 'AI-powered invoice parser',
        supporting_signal_ids: ['sig-1']
      }],
      journal_entries: [{ entry_type: 'thesis_evolution', topic: 'billing', insight: 'strong trend', narrative: 'analysis...', confidence: 75, thesis_keys: ['billing:copilot'], signal_ids: ['sig-1'] }]
    };

    // First call = broad scan, second call = deep dive
    let callCount = 0;
    const mockClaude = vi.fn().mockImplementation(() => {
      callCount++;
      const output = callCount === 1 ? broadOutput : deepOutput;
      return Promise.resolve({ text: JSON.stringify(output), provider: 'claude', meta: {} });
    });

    const journalEntries: Array<{ insight: string }> = [];
    const mockJournal = {
      write: vi.fn().mockImplementation((entries: Array<{ insight: string }>) => { journalEntries.push(...entries); return Promise.resolve(); }),
      recent: vi.fn().mockResolvedValue([]),
      byType: vi.fn().mockResolvedValue([]),
      byThesisKey: vi.fn().mockResolvedValue([]),
      findSimilar: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0)
    };

    const result = await runResearchAgent({
      thesisStore: store,
      journalStore: mockJournal,
      runClaude: mockClaude,
      runCodex: failingAi()
    });

    expect(result.deepDivesPerformed).toBe(1);
    expect(result.newCandidates).toBe(1);
    expect(result.thesesUpdated).toBe(1);
    expect(result.journalEntriesWritten).toBeGreaterThan(0);
    expect(mockJournal.write).toHaveBeenCalled();

    // Verify thesis was updated by deep dive
    const updated = await store.getByKey('billing:copilot');
    expect(updated?.confidence).toBe(75); // 60 + 15

    // Verify new thesis was created
    const all = await store.list();
    expect(all.find((t) => t.title === 'Invoice AI')).toBeDefined();
  });

  it('writes run summary journal entry even with no deep dives', async () => {
    const store = new InMemoryThesisStore();

    const broadOutput = {
      thesis_updates: [],
      dig_deeper: [],
      observations: [{ entry_type: 'market_signal', topic: 'general', insight: 'quiet period', narrative: 'no major shifts' }]
    };

    const journalEntries: Array<{ entry_type: string }> = [];
    const mockJournal = {
      write: vi.fn().mockImplementation((entries: Array<{ entry_type: string }>) => { journalEntries.push(...entries); return Promise.resolve(); }),
      recent: vi.fn().mockResolvedValue([]),
      byType: vi.fn().mockResolvedValue([]),
      byThesisKey: vi.fn().mockResolvedValue([]),
      findSimilar: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0)
    };

    const result = await runResearchAgent({
      thesisStore: store,
      journalStore: mockJournal,
      runClaude: mockAiResponse(JSON.stringify(broadOutput)),
      runCodex: failingAi()
    });

    expect(result.deepDivesPerformed).toBe(0);
    expect(result.journalEntriesWritten).toBe(2); // 1 observation + 1 run_summary
    const summary = journalEntries.find((e) => e.entry_type === 'run_summary');
    expect(summary).toBeDefined();
  });

  it('clamps confidence delta to ±20', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'test:thesis', title: 'Test', topic: 'test',
      status: 'watching', confidence: 50, scoreTotal: 50,
      problemStatement: 'p', targetBuyer: 'b', proposedSolution: 's',
      evidenceCount: 3, avgDemand: 50, avgTiming: 50, avgBuildability: 50, avgVirality: 0,
      latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    });

    const broadOutput = {
      thesis_updates: [{ canonicalKey: 'test:thesis', confidence_delta: 50, reasoning: 'huge jump' }],
      dig_deeper: [],
      observations: []
    };

    await runResearchAgent({
      thesisStore: store,
      runClaude: mockAiResponse(JSON.stringify(broadOutput)),
      runCodex: failingAi()
    });

    const updated = await store.getByKey('test:thesis');
    expect(updated?.confidence).toBe(70); // 50 + 20 (clamped from 50)
  });
});
