import type { FastifyInstance } from 'fastify';
import { generateDeepDive } from '../jobs/deep_dive_generator';
import type { DeepDiveGeneratorDeps } from '../jobs/deep_dive_generator';
import { buildThesisCandidates } from '../jobs/thesis_synthesizer';
import type { ExecutionLogger } from '../runtime/execution_logger';
import type { PostgresMemoryStore } from '../runtime/postgres_memory_store';
import type { PaginatedThesisStore } from '../runtime/postgres_thesis_store';
import type { DeepDiveStore } from '../runtime/deep_dive_store';
import type { ThesisStore } from '../runtime/thesis_store';

export type ThesesRouteDeps = {
  store: ThesisStore;
  memoryStore?: PostgresMemoryStore | null;
  deepDiveStore?: DeepDiveStore | null;
  deepDiveAi?: DeepDiveGeneratorDeps | null;
  logger?: Pick<ExecutionLogger, 'info' | 'debug' | 'error'>;
};

export const registerThesesRoute = (
  app: FastifyInstance,
  storeOrDeps: ThesisStore | ThesesRouteDeps
): void => {
  const deps: ThesesRouteDeps =
    'store' in storeOrDeps ? storeOrDeps : { store: storeOrDeps };

  app.get('/v1/theses', async (request) => {
    const query = request.query as { page?: string; page_size?: string; status?: string; sort?: string; profile?: string };
    const validSorts = ['score', 'latest', 'evidence', 'newest'] as const;
    const sort = validSorts.includes(query.sort as typeof validSorts[number])
      ? (query.sort as typeof validSorts[number])
      : 'score';

    // If the store supports pagination, use it
    if ('listPaginated' in deps.store) {
      const page = Math.max(1, Number(query.page) || 1);
      const pageSize = Math.min(50, Math.max(1, Number(query.page_size) || 10));
      const profile = (query as any).profile || 'all';
      return (deps.store as PaginatedThesisStore).listPaginated({
        page,
        pageSize,
        sort,
        ...(query.status ? { status: query.status } : {}),
        ...(profile !== 'all' ? { profile } : {})
      });
    }

    // Fallback: return flat list for InMemoryThesisStore
    return deps.store.list(query.status ? { status: query.status as 'watching' } : undefined);
  });

  app.get('/v1/theses/:key', {
    schema: {
      params: {
        type: 'object',
        properties: {
          key: { type: 'string', minLength: 1, maxLength: 200 }
        },
        required: ['key']
      }
    }
  }, async (request, reply) => {
    const { key } = request.params as { key: string };
    if (!key) {
      reply.code(400);
      return { error: 'Missing thesis key' };
    }

    const draft = await deps.store.getByKey(key);
    if (!draft) {
      reply.code(404);
      return { error: 'Thesis not found' };
    }

    return draft;
  });

  app.post('/v1/theses/synthesize', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (_request, reply) => {
    if (!deps.memoryStore) {
      reply.code(503);
      return { error: 'Memory store not available' };
    }

    const signals = await deps.memoryStore.listAllSignals(500);
    if (signals.length === 0) {
      return { theses: [], message: 'No signals in memory store' };
    }

    const candidates = buildThesisCandidates(signals);
    for (const candidate of candidates) {
      await deps.store.upsert(candidate);
    }

    return {
      theses: candidates.length,
      signals: signals.length,
      candidates: candidates.map((t) => ({
        key: t.canonicalKey,
        title: t.title,
        status: t.status,
        confidence: t.confidence,
        evidenceCount: t.evidenceCount
      }))
    };
  });

  // GET /v1/theses/:key/deep-dive
  app.get('/v1/theses/:key/deep-dive', {
    schema: {
      params: {
        type: 'object',
        properties: { key: { type: 'string', minLength: 1, maxLength: 200 } },
        required: ['key']
      }
    }
  }, async (request, reply) => {
    if (!deps.deepDiveStore) {
      reply.code(503);
      return { error: 'Deep-dive store not available' };
    }
    const { key } = request.params as { key: string };
    const cached = await deps.deepDiveStore.getByKey(key);
    if (!cached) {
      reply.code(404);
      return { error: 'Deep-dive not generated yet' };
    }
    return cached;
  });

  // POST /v1/theses/:key/deep-dive
  app.post('/v1/theses/:key/deep-dive', {
    schema: {
      params: {
        type: 'object',
        properties: { key: { type: 'string', minLength: 1, maxLength: 200 } },
        required: ['key']
      }
    },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    if (!deps.deepDiveStore || !deps.deepDiveAi) {
      reply.code(503);
      return { error: 'Deep-dive not available' };
    }
    const { key } = request.params as { key: string };

    // Return cached if exists
    const cached = await deps.deepDiveStore.getByKey(key);
    if (cached) {
      await deps.logger?.info('deep_dive', 'deep-dive served from cache', { thesis: key });
      return cached;
    }

    // Fetch thesis data
    const thesis = await deps.store.getByKey(key);
    if (!thesis) {
      reply.code(404);
      return { error: 'Thesis not found' };
    }

    // Generate via AI
    await deps.logger?.info('deep_dive', 'deep-dive generation requested', { thesis: key, title: thesis.title });
    const startMs = Date.now();
    try {
      const { result, provider } = await generateDeepDive({
        title: thesis.title,
        problemStatement: thesis.problemStatement,
        targetBuyer: thesis.targetBuyer,
        proposedSolution: thesis.proposedSolution,
        confidence: thesis.confidence,
      }, { ...deps.deepDiveAi, logger: deps.logger });

      // Save and return
      const saved = await deps.deepDiveStore.save(key, {
        summary: result.summary,
        howItWorks: result.howItWorks,
        growthStrategy: result.growthStrategy,
        buildSuggestions: result.buildSuggestions,
        generatedBy: provider,
      });

      await deps.logger?.info('deep_dive', 'deep-dive saved', {
        thesis: key, provider, duration_ms: Date.now() - startMs
      });

      return saved;
    } catch (err) {
      await deps.logger?.error('deep_dive', 'deep-dive generation failed', {
        thesis: key,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - startMs
      });
      throw err;
    }
  });
};
