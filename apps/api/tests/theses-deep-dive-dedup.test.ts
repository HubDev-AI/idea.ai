import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

describe('deep-dive dedup', () => {
  const servers: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
  });

  it('concurrent POST /v1/theses/:key/deep-dive only calls AI once', async () => {
    let generateCallCount = 0;
    let resolveGenerate!: () => void;
    const generateDone = new Promise<void>((r) => {
      resolveGenerate = r;
    });

    const savedResult = {
      canonicalKey: 'test:idea',
      summary: 's',
      howItWorks: 'h',
      growthStrategy: 'g',
      buildSuggestions: 'b',
      generatedBy: 'claude',
      createdAt: new Date().toISOString(),
    };

    const fakeThesis = {
      canonicalKey: 'test:idea',
      title: 'Test Idea',
      topic: 'test',
      status: 'watching' as const,
      confidence: 60,
      scoreTotal: 60,
      problemStatement: 'pain',
      targetBuyer: 'devs',
      proposedSolution: 'solution',
      evidenceCount: 1,
      avgDemand: 60,
      avgTiming: 60,
      avgBuildability: 60,
      avgVirality: 60,
      latestObservedAt: new Date().toISOString(),
      evidence: [],
    };

    // Fake thesis store
    const thesisStore = {
      upsert: async () => {},
      list: async () => [],
      getByKey: async (key: string) => (key === 'test:idea' ? fakeThesis : null),
    };

    // Fake deep-dive store: first call returns null, subsequent calls return the saved result
    let saveCallCount = 0;
    const deepDiveStore = {
      getByKey: async (_key: string) => null,
      save: async (_key: string, _data: unknown) => {
        saveCallCount++;
        return savedResult;
      },
    };

    // Fake AI deps: runClaude is the gating call we count
    const fakeRunClaude = async (_input: unknown) => {
      generateCallCount++;
      // Wait until we release the latch (all 3 concurrent requests have been fired)
      await generateDone;
      return {
        text: JSON.stringify({
          summary: 's',
          how_it_works: 'h',
          growth_strategy: 'g',
          build_suggestions: 'b',
        }),
        provider: 'claude' as const,
        meta: {} as Record<string, unknown>,
      };
    };

    const fakeRunCodex = async (_input: unknown) => {
      return {
        text: JSON.stringify({
          summary: 's',
          how_it_works: 'h',
          growth_strategy: 'g',
          build_suggestions: 'b',
        }),
        provider: 'codex' as const,
        meta: {} as Record<string, unknown>,
      };
    };

    const deepDiveAi = {
      runClaude: fakeRunClaude,
      runCodex: fakeRunCodex,
      preferredProvider: 'claude' as const,
    };

    const server = await buildServer({
      listSignals: async () => [],
      listConnectors: async () => [],
      thesisStore,
      deepDiveStore,
      deepDiveAi,
    });
    servers.push(server);

    // Fire 3 concurrent POSTs before the AI call resolves
    const requests = [
      server.inject({ method: 'POST', url: '/v1/theses/test:idea/deep-dive' }),
      server.inject({ method: 'POST', url: '/v1/theses/test:idea/deep-dive' }),
      server.inject({ method: 'POST', url: '/v1/theses/test:idea/deep-dive' }),
    ];

    // Allow microtasks to run so all 3 requests are in-flight before we release
    await new Promise<void>((r) => setTimeout(r, 10));

    // Release the AI latch
    resolveGenerate();

    const responses = await Promise.all(requests);

    for (const res of responses) {
      expect(res.statusCode).toBe(200);
    }

    // The key assertion: AI was only called once despite 3 concurrent requests
    expect(generateCallCount).toBe(1);
  });
});
