import { describe, expect, it } from 'vitest';
import type { ThesisDraft } from '../src/jobs/thesis_synthesizer';
import { InMemoryThesisStore } from '../src/runtime/thesis_store';

describe('thesis store', () => {
  it('upserts thesis candidates', async () => {
    const store = new InMemoryThesisStore();
    const draft: ThesisDraft = {
      canonicalKey: 'compliance:compliance:audit',
      title: 'audit compliance copilot for compliance',
      topic: 'compliance',
      status: 'candidate',
      confidence: 55,
      scoreTotal: 55,
      problemStatement: 'Compliance tasks keep recurring.',
      targetBuyer: 'Engineering teams',
      proposedSolution: 'Automate evidence capture.',
      evidenceCount: 3,
      avgPain: 70,
      avgTiming: 60,
      avgBuildability: 65,
      latestObservedAt: '2026-02-25T10:00:00Z',
      evidence: []
    };

    await store.upsert(draft);
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.canonicalKey).toBe('compliance:compliance:audit');
  });

  it('updates existing thesis on second upsert', async () => {
    const store = new InMemoryThesisStore();
    const draft: ThesisDraft = {
      canonicalKey: 'test:key',
      title: 'test', topic: 'test', status: 'candidate',
      confidence: 50, scoreTotal: 50,
      problemStatement: 'p', targetBuyer: 't', proposedSolution: 's',
      evidenceCount: 2, avgPain: 50, avgTiming: 50, avgBuildability: 50,
      latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    };

    await store.upsert(draft);
    await store.upsert({ ...draft, confidence: 75, status: 'watching' });

    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.confidence).toBe(75);
    expect(all[0]!.status).toBe('watching');
  });

  it('filters by status', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'a', title: 'a', topic: 't', status: 'promoted',
      confidence: 85, scoreTotal: 85, problemStatement: 'p', targetBuyer: 'b',
      proposedSolution: 's', evidenceCount: 5, avgPain: 80, avgTiming: 70,
      avgBuildability: 75, latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    });
    await store.upsert({
      canonicalKey: 'b', title: 'b', topic: 't', status: 'candidate',
      confidence: 40, scoreTotal: 40, problemStatement: 'p', targetBuyer: 'b',
      proposedSolution: 's', evidenceCount: 2, avgPain: 40, avgTiming: 30,
      avgBuildability: 50, latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    });

    const promoted = await store.list({ status: 'promoted' });
    expect(promoted).toHaveLength(1);
    expect(promoted[0]!.canonicalKey).toBe('a');
  });
});
