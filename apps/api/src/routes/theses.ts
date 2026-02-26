import type { FastifyInstance } from 'fastify';
import { buildThesisCandidates } from '../jobs/thesis_synthesizer';
import type { PostgresMemoryStore } from '../runtime/postgres_memory_store';
import type { ThesisStore } from '../runtime/thesis_store';

export type ThesesRouteDeps = {
  store: ThesisStore;
  memoryStore?: PostgresMemoryStore | null;
};

export const registerThesesRoute = (
  app: FastifyInstance,
  storeOrDeps: ThesisStore | ThesesRouteDeps
): void => {
  const deps: ThesesRouteDeps =
    'store' in storeOrDeps ? storeOrDeps : { store: storeOrDeps };

  app.get('/v1/theses', async () => {
    return deps.store.list();
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
};
