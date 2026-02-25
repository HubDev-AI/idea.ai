import type { FastifyInstance } from 'fastify';
import type { ThesisStore } from '../runtime/thesis_store';

export const registerThesesRoute = (
  app: FastifyInstance,
  store: ThesisStore
): void => {
  app.get('/v1/theses', async () => {
    return store.list();
  });

  app.get('/v1/theses/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    if (!key) {
      reply.code(400);
      return { error: 'Missing thesis key' };
    }

    const draft = await store.getByKey(key);
    if (!draft) {
      reply.code(404);
      return { error: 'Thesis not found' };
    }

    return draft;
  });
};
