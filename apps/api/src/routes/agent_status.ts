import type { AgentRunAccepted, AgentStatusRecord } from '@idea/contracts/src/api';
import type { FastifyInstance } from 'fastify';
import type { AgentRunStore } from '../runtime/agent_run_store';

export type { AgentStatusRecord } from '@idea/contracts/src/api';

export type AgentStatusDeps = {
  getAgentStatus: () => AgentStatusRecord;
  triggerRun: () => AgentRunAccepted;
  agentRunStore?: AgentRunStore | null;
};

export const registerAgentStatusRoute = (
  app: FastifyInstance,
  deps: AgentStatusDeps
): void => {
  app.get('/v1/agent/status', async () => deps.getAgentStatus());

  app.get('/v1/agent/runs', async (request) => {
    if (!deps.agentRunStore) {
      return { items: [] };
    }
    const query = request.query as { limit?: string };
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    return { items: await deps.agentRunStore.list(limit) };
  });

  app.post('/v1/agent/run', {
    config: { rateLimit: { max: 100, timeWindow: '1 minute' } }
  }, async (_request, reply) => {
    // Fire-and-forget: websocket agentStatus events drive the client lifecycle.
    return reply.code(202).send(deps.triggerRun());
  });
};
