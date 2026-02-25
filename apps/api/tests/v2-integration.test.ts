import { describe, expect, it, vi } from 'vitest';
import { classifyBatch } from '@idea/pipeline/src/scoring/noise_gate';
import { aiScoreSignal } from '@idea/pipeline/src/scoring/ai_score';
import { reconcileScores, dualAnalystRun } from '@idea/ai-runtime/src/dual_analyst';
import { embedText } from '@idea/ai-runtime/src/ollama';
import { mergeByRRF } from '@idea/pipeline/src/memory/hybrid_search';
import { findDuplicates } from '@idea/pipeline/src/dedup';
import { InMemoryThesisStore } from '../src/runtime/thesis_store';
import { runResearchAgent } from '../src/jobs/agent_runner';
import { buildServer } from '../src/server';

describe('V2 integration', () => {
  it('noise gate classifies a batch of signals', async () => {
    const mockRunPrompt = vi.fn().mockResolvedValue({
      text: JSON.stringify([
        { id: 'sig-1', classification: 'strong' },
        { id: 'sig-2', classification: 'noise' }
      ]),
      provider: 'claude',
      meta: {}
    });

    const result = await classifyBatch(
      [
        { id: 'sig-1', text: 'SOC2 compliance takes 3 months' },
        { id: 'sig-2', text: 'Check out my portfolio website' }
      ],
      { runPrompt: mockRunPrompt }
    );

    expect(result).toHaveLength(2);
    expect(result[0].classification).toBe('strong');
    expect(result[1].classification).toBe('noise');
  });

  it('AI scoring produces structured scores', async () => {
    const mockRunPrompt = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        pain: 85,
        timing: 72,
        buildability: 68,
        reasoning: 'Strong compliance pain with clear timing signal'
      }),
      provider: 'claude',
      meta: {}
    });

    const result = await aiScoreSignal(
      { text: 'SOC2 audit pain', source: 'hn', topic: 'compliance' },
      { runPrompt: mockRunPrompt }
    );

    expect(result).not.toBeNull();
    expect(result!.pain).toBe(85);
    expect(result!.timing).toBe(72);
    expect(result!.buildability).toBe(68);
    expect(result!.reasoning).toContain('compliance');
  });

  it('dual analyst reconciles aligned scores', () => {
    const result = reconcileScores(
      { pain: 80, timing: 70, buildability: 65 },
      { pain: 75, timing: 68, buildability: 70 }
    );

    expect(result.agreement).toBe('aligned');
    expect(result.pain).toBe(78); // avg(80, 75) = 77.5, rounded to 78
    expect(result.timing).toBe(69); // avg(70, 68) = 69
    expect(result.buildability).toBe(68); // avg(65, 70) = 67.5, rounded to 68
    expect(result.contestedDimensions).toHaveLength(0);
  });

  it('dual analyst detects contested scores', () => {
    const result = reconcileScores(
      { pain: 90, timing: 70, buildability: 65 },
      { pain: 40, timing: 68, buildability: 70 }
    );

    expect(result.agreement).toBe('contested');
    expect(result.contestedDimensions).toContain('pain');
  });

  it('dual analyst returns single when only one provider responds', () => {
    const result = reconcileScores(
      { pain: 80, timing: 70, buildability: 65 },
      null
    );

    expect(result.agreement).toBe('single');
    expect(result.pain).toBe(80);
  });

  it('dualAnalystRun calls both providers in parallel', async () => {
    const result = await dualAnalystRun<{ value: number }>(
      { prompt: 'test prompt' },
      {
        runClaude: vi.fn().mockResolvedValue({
          text: '{"value": 42}',
          provider: 'claude',
          meta: {}
        }),
        runCodex: vi.fn().mockResolvedValue({
          text: '{"value": 43}',
          provider: 'codex',
          meta: {}
        }),
        parseResponse: (text: string) => JSON.parse(text) as { value: number }
      }
    );

    expect(result.claude).toEqual({ value: 42 });
    expect(result.codex).toEqual({ value: 43 });
  });

  it('dualAnalystRun handles provider failure gracefully', async () => {
    const result = await dualAnalystRun<{ value: number }>(
      { prompt: 'test prompt' },
      {
        runClaude: vi.fn().mockResolvedValue({
          text: '{"value": 42}',
          provider: 'claude',
          meta: {}
        }),
        runCodex: vi.fn().mockRejectedValue(new Error('codex unavailable')),
        parseResponse: (text: string) => JSON.parse(text) as { value: number }
      }
    );

    expect(result.claude).toEqual({ value: 42 });
    expect(result.codex).toBeNull();
  });

  it('Ollama embedText generates vectors via mock fetch', async () => {
    const fakeEmbedding = Array.from({ length: 384 }, (_, i) => i * 0.001);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: fakeEmbedding })
    });

    const result = await embedText('test document text', {
      fetchImpl: mockFetch as unknown as typeof fetch
    });

    expect(result).not.toBeNull();
    expect(result).toHaveLength(384);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/embeddings',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('test document text')
      })
    );
  });

  it('Ollama embedText returns null on failure with fallbackToNull', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500
    });

    const result = await embedText('test', {
      fetchImpl: mockFetch as unknown as typeof fetch,
      fallbackToNull: true
    });

    expect(result).toBeNull();
  });

  it('hybrid search merges results with RRF', () => {
    const merged = mergeByRRF(
      [{ signal_id: 'a', rank: 1 }, { signal_id: 'b', rank: 2 }],
      [{ signal_id: 'b', rank: 1 }, { signal_id: 'c', rank: 2 }],
      { k: 60 }
    );

    // 'b' appears in both lists, so it should have the highest RRF score
    expect(merged[0].signal_id).toBe('b');
    expect(merged.length).toBe(3);

    // Verify RRF scores are positive numbers
    for (const r of merged) {
      expect(r.rrf_score).toBeGreaterThan(0);
    }
  });

  it('hybrid search respects topN limit', () => {
    const merged = mergeByRRF(
      [{ signal_id: 'a', rank: 1 }, { signal_id: 'b', rank: 2 }, { signal_id: 'c', rank: 3 }],
      [{ signal_id: 'd', rank: 1 }, { signal_id: 'e', rank: 2 }],
      { k: 60, topN: 2 }
    );

    expect(merged).toHaveLength(2);
  });

  it('cross-source dedup finds duplicates', () => {
    const vec = Array.from({ length: 10 }, (_, i) => i * 0.1);
    const dupes = findDuplicates([
      { signal_id: 'hn-1', source: 'hn', embedding: vec },
      { signal_id: 'gh-1', source: 'github_issues', embedding: vec.map(v => v + 0.0001) }
    ], { threshold: 0.99 });

    expect(dupes).toHaveLength(1);
    expect(dupes[0].signals).toContain('hn-1');
    expect(dupes[0].signals).toContain('gh-1');
    expect(dupes[0].similarity).toBeGreaterThanOrEqual(0.99);
  });

  it('cross-source dedup skips same-source signals', () => {
    const vec = Array.from({ length: 10 }, (_, i) => i * 0.1);
    const dupes = findDuplicates([
      { signal_id: 'hn-1', source: 'hn', embedding: vec },
      { signal_id: 'hn-2', source: 'hn', embedding: vec }
    ], { threshold: 0.99 });

    expect(dupes).toHaveLength(0);
  });

  it('cross-source dedup ignores dissimilar signals', () => {
    const vecA = Array.from({ length: 10 }, (_, i) => i * 0.1);
    const vecB = Array.from({ length: 10 }, (_, i) => (10 - i) * 0.1);
    const dupes = findDuplicates([
      { signal_id: 'hn-1', source: 'hn', embedding: vecA },
      { signal_id: 'gh-1', source: 'github_issues', embedding: vecB }
    ], { threshold: 0.99 });

    expect(dupes).toHaveLength(0);
  });

  it('thesis store manages CRUD lifecycle', async () => {
    const store = new InMemoryThesisStore();

    // Initially empty
    expect(await store.list()).toHaveLength(0);
    expect(await store.getByKey('nonexistent')).toBeNull();

    // Upsert a thesis
    await store.upsert({
      canonicalKey: 'test:thesis',
      title: 'Test Thesis',
      topic: 'test',
      status: 'watching',
      confidence: 65,
      scoreTotal: 65,
      problemStatement: 'test problem',
      targetBuyer: 'engineers',
      proposedSolution: 'test solution',
      evidenceCount: 3,
      avgPain: 60,
      avgTiming: 55,
      avgBuildability: 50,
      latestObservedAt: '2026-02-25T10:00:00Z',
      evidence: []
    });

    expect(await store.list()).toHaveLength(1);

    const retrieved = await store.getByKey('test:thesis');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe('Test Thesis');

    // Upsert updates existing
    await store.upsert({
      canonicalKey: 'test:thesis',
      title: 'Updated Thesis',
      topic: 'test',
      status: 'promoted',
      confidence: 85,
      scoreTotal: 85,
      problemStatement: 'updated problem',
      targetBuyer: 'engineers',
      proposedSolution: 'updated solution',
      evidenceCount: 7,
      avgPain: 75,
      avgTiming: 70,
      avgBuildability: 65,
      latestObservedAt: '2026-02-25T12:00:00Z',
      evidence: []
    });

    expect(await store.list()).toHaveLength(1);
    const updated = await store.getByKey('test:thesis');
    expect(updated!.title).toBe('Updated Thesis');
    expect(updated!.confidence).toBe(85);
  });

  it('thesis store filters by status', async () => {
    const store = new InMemoryThesisStore();

    await store.upsert({
      canonicalKey: 'a', title: 'A', topic: 't', status: 'watching',
      confidence: 60, scoreTotal: 60, problemStatement: 'p', targetBuyer: 'b',
      proposedSolution: 's', evidenceCount: 2, avgPain: 50, avgTiming: 50,
      avgBuildability: 50, latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    });

    await store.upsert({
      canonicalKey: 'b', title: 'B', topic: 't', status: 'promoted',
      confidence: 90, scoreTotal: 90, problemStatement: 'p', targetBuyer: 'b',
      proposedSolution: 's', evidenceCount: 8, avgPain: 80, avgTiming: 75,
      avgBuildability: 70, latestObservedAt: '2026-02-25T10:00:00Z', evidence: []
    });

    const promoted = await store.list({ status: 'promoted' });
    expect(promoted).toHaveLength(1);
    expect(promoted[0].title).toBe('B');
  });

  it('research agent updates thesis confidence and creates candidates', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'compliance:soc2',
      title: 'SOC2 copilot',
      topic: 'compliance',
      status: 'watching',
      confidence: 72,
      scoreTotal: 72,
      problemStatement: 'p',
      targetBuyer: 'b',
      proposedSolution: 's',
      evidenceCount: 5,
      avgPain: 70,
      avgTiming: 60,
      avgBuildability: 65,
      latestObservedAt: '2026-02-25T10:00:00Z',
      evidence: []
    });

    const agentResponse = JSON.stringify({
      theses_updated: [
        { canonicalKey: 'compliance:soc2', confidence_delta: 10, reasoning: 'strong new signals' }
      ],
      new_theses: [
        {
          title: 'Billing Copilot',
          problem_statement: 'billing pain',
          target_buyer: 'finance',
          proposed_solution: 'automate',
          supporting_signal_ids: ['s1']
        }
      ],
      alerts: ['compliance:soc2'],
      investigate_next: 'pricing'
    });

    const result = await runResearchAgent({
      thesisStore: store,
      runClaude: vi.fn().mockResolvedValue({
        text: agentResponse,
        provider: 'claude',
        meta: {}
      }),
      runCodex: vi.fn().mockRejectedValue(new Error('unavailable'))
    });

    expect(result.thesesUpdated).toBe(1);
    expect(result.newCandidates).toBe(1);
    expect(result.alerts).toContain('compliance:soc2');
    expect(result.investigateNext).toBe('pricing');

    // Verify thesis was updated: 72 + 10 = 82 -> promoted
    const updated = await store.getByKey('compliance:soc2');
    expect(updated).not.toBeNull();
    expect(updated!.confidence).toBe(82);
    expect(updated!.status).toBe('promoted');

    // Verify new candidate was created
    const all = await store.list();
    expect(all).toHaveLength(2);
    const candidate = all.find(t => t.title === 'Billing Copilot');
    expect(candidate).toBeDefined();
    expect(candidate!.status).toBe('candidate');
    expect(candidate!.confidence).toBe(45);
  });

  it('research agent returns empty result when both providers fail', async () => {
    const store = new InMemoryThesisStore();

    const result = await runResearchAgent({
      thesisStore: store,
      runClaude: vi.fn().mockRejectedValue(new Error('claude down')),
      runCodex: vi.fn().mockRejectedValue(new Error('codex down'))
    });

    expect(result.thesesUpdated).toBe(0);
    expect(result.newCandidates).toBe(0);
    expect(result.alerts).toHaveLength(0);
  });

  it('thesis API returns theses from store', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'test',
      title: 'Test Thesis',
      topic: 't',
      status: 'watching',
      confidence: 65,
      scoreTotal: 65,
      problemStatement: 'p',
      targetBuyer: 'b',
      proposedSolution: 's',
      evidenceCount: 3,
      avgPain: 60,
      avgTiming: 55,
      avgBuildability: 50,
      latestObservedAt: '2026-02-25T10:00:00Z',
      evidence: []
    });

    const app = buildServer({ thesisStore: store });
    const response = await app.inject({ method: 'GET', url: '/v1/theses' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe('Test Thesis');
  });

  it('thesis API returns individual thesis by canonicalKey', async () => {
    const store = new InMemoryThesisStore();
    await store.upsert({
      canonicalKey: 'test',
      title: 'Test Thesis',
      topic: 't',
      status: 'watching',
      confidence: 65,
      scoreTotal: 65,
      problemStatement: 'p',
      targetBuyer: 'b',
      proposedSolution: 's',
      evidenceCount: 3,
      avgPain: 60,
      avgTiming: 55,
      avgBuildability: 50,
      latestObservedAt: '2026-02-25T10:00:00Z',
      evidence: []
    });

    const app = buildServer({ thesisStore: store });

    const response = await app.inject({ method: 'GET', url: '/v1/theses/test' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.title).toBe('Test Thesis');
    expect(body.canonicalKey).toBe('test');

    // Non-existent key returns 404
    const missing = await app.inject({ method: 'GET', url: '/v1/theses/nonexistent' });
    expect(missing.statusCode).toBe(404);
  });
});
