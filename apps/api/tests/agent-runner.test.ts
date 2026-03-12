import { describe, expect, it, vi } from 'vitest';
import { runResearchAgent } from '../src/jobs/agent_runner';
import { consumerProfile } from '../src/profiles/consumer';
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

  it('throws when no provider returns a usable broad scan', async () => {
    const store = new InMemoryThesisStore();
    await expect(runResearchAgent({
      thesisStore: store,
      runClaude: failingAi(),
      runCodex: failingAi()
    })).rejects.toThrow(/No AI provider returned a usable response/i);
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

  it('scopes active thesis context and updates to the current profile', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'consumer:meal',
      title: 'Meal Planner',
      topic: 'consumer',
      status: 'watching',
      confidence: 60,
      scoreTotal: 60,
      problemStatement: 'p',
      targetBuyer: 'b',
      proposedSolution: 's',
      evidenceCount: 1,
      avgDemand: 50,
      avgTiming: 50,
      avgBuildability: 50,
      avgVirality: 50,
      latestObservedAt: '2026-02-25T10:00:00Z',
      evidence: [],
      profileId: 'consumer',
    });
    await store.upsert({
      canonicalKey: 'b2b:soc2',
      title: 'SOC2 Autopilot',
      topic: 'b2b',
      status: 'watching',
      confidence: 70,
      scoreTotal: 70,
      problemStatement: 'p',
      targetBuyer: 'b',
      proposedSolution: 's',
      evidenceCount: 1,
      avgDemand: 60,
      avgTiming: 60,
      avgBuildability: 60,
      avgVirality: 20,
      latestObservedAt: '2026-02-25T10:00:00Z',
      evidence: [],
      profileId: 'b2b',
    });

    const prompts: string[] = [];
    const runClaude = vi.fn().mockImplementation(async ({ prompt }: { prompt: string }) => {
      prompts.push(prompt);
      return {
        text: JSON.stringify({
          thesis_updates: [
            { canonicalKey: 'consumer:meal', confidence_delta: 5, reasoning: 'consumer fit' },
            { canonicalKey: 'b2b:soc2', confidence_delta: 15, reasoning: 'should be ignored' },
          ],
          dig_deeper: [],
          observations: [],
        }),
        provider: 'claude',
        meta: {},
      };
    });

    await runResearchAgent({
      thesisStore: store,
      runClaude,
      runCodex: failingAi(),
      profile: consumerProfile,
      debateEnabled: false,
    });

    expect(prompts[0]).toContain('Meal Planner');
    expect(prompts[0]).not.toContain('SOC2 Autopilot');
    expect((await store.getByKey('consumer:meal'))?.confidence).toBe(65);
    expect((await store.getByKey('b2b:soc2'))?.confidence).toBe(70);
  });

  it('does not dedup new theses against a different profile', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'b2b:ops',
      title: 'Ops Workflow Copilot',
      topic: 'operations',
      status: 'watching',
      confidence: 68,
      scoreTotal: 68,
      problemStatement: 'p',
      targetBuyer: 'b',
      proposedSolution: 's',
      evidenceCount: 2,
      avgDemand: 60,
      avgTiming: 55,
      avgBuildability: 50,
      avgVirality: 15,
      latestObservedAt: '2026-02-25T10:00:00Z',
      evidence: [],
      profileId: 'b2b',
    });

    let callCount = 0;
    const runClaude = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          text: JSON.stringify({
            thesis_updates: [],
            dig_deeper: [{ topic: 'ops workflow', reason: 'demand rising', related_cluster_ids: [] }],
            observations: [],
          }),
          provider: 'claude',
          meta: {},
        };
      }
      return {
        text: JSON.stringify({
          thesis_updates: [],
          new_theses: [{
            title: 'Ops Workflow Copilot',
            problem_statement: 'Manual team coordination is slow',
            target_buyer: 'Consumers',
            proposed_solution: 'Consumer-facing task coordination app',
            supporting_signal_ids: ['sig-1'],
            estimated_scope: 'small',
          }],
          journal_entries: [],
        }),
        provider: 'claude',
        meta: {},
      };
    });

    await runResearchAgent({
      thesisStore: store,
      runClaude,
      runCodex: failingAi(),
      profile: consumerProfile,
      debateEnabled: false,
    });

    const theses = await store.list();
    const consumerCopy = theses.find((t) => t.canonicalKey.startsWith('consumer:') && t.title === 'Ops Workflow Copilot');
    const original = await store.getByKey('b2b:ops');
    expect(consumerCopy).toBeDefined();
    expect(consumerCopy?.profileId).toBe('consumer');
    expect(original?.confidence).toBe(68);
  });

  it('builds trend summary from recent signals instead of synthetic empty windows', async () => {
    const store = new InMemoryThesisStore();
    const prompts: string[] = [];
    const runClaude = vi.fn().mockImplementation(async ({ prompt }: { prompt: string }) => {
      prompts.push(prompt);
      return {
        text: JSON.stringify({
          thesis_updates: [],
          dig_deeper: [],
          observations: [],
        }),
        provider: 'claude',
        meta: {},
      };
    });

    const signalStore = {
      listAllSignals: vi.fn().mockResolvedValue([
        {
          signal_id: 'sig-1',
          canonical_text: 'Users keep asking for shared travel planning',
          source: 'reddit',
          topic: 'travel_planning',
          demand: 84,
          timing: 63,
          virality: 51,
          blended: 70,
          observed_at: new Date().toISOString(),
        },
      ]),
      getEmbeddings: vi.fn().mockResolvedValue(new Map()),
      retriever: {
        getTrendWindows: vi.fn().mockResolvedValue([]),
        findSimilar: vi.fn().mockResolvedValue([]),
      },
    } as any;

    await runResearchAgent({
      thesisStore: store,
      signalStore,
      runClaude,
      runCodex: failingAi(),
      debateEnabled: false,
    });

    expect(prompts[0]).toContain('travel_planning');
    expect(prompts[0]).toContain('7d');
    expect(signalStore.retriever.getTrendWindows).not.toHaveBeenCalled();
  });

  it('honors the configured retry budget for provider calls', async () => {
    const store = new InMemoryThesisStore();
    const runClaude = vi.fn()
      .mockRejectedValueOnce(new Error('try 1'))
      .mockRejectedValueOnce(new Error('try 2'))
      .mockResolvedValueOnce({
        text: JSON.stringify({
          thesis_updates: [],
          dig_deeper: [],
          observations: [],
        }),
        provider: 'claude',
        meta: {},
      });

    const result = await runResearchAgent({
      thesisStore: store,
      runClaude,
      runCodex: failingAi(),
      allowFallback: false,
      preferredProvider: 'claude',
      retries: 2,
      debateEnabled: false,
    });

    expect(runClaude).toHaveBeenCalledTimes(3);
    expect(result.provider).toBe('claude');
  });
});
