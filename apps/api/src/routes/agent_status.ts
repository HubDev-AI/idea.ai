import type { AgentStatusRecord } from '@idea/contracts/src/api';
import type { FastifyInstance } from 'fastify';
import type { AgentRunResult } from '../jobs/agent_runner';

export type { AgentStatusRecord } from '@idea/contracts/src/api';

export type AgentStatusDeps = {
  getAgentStatus: () => AgentStatusRecord;
  triggerRun: () => Promise<AgentRunResult>;
};

export const registerAgentStatusRoute = (
  app: FastifyInstance,
  deps: AgentStatusDeps
): void => {
  app.get('/v1/agent/status', async () => deps.getAgentStatus());

  app.post('/v1/agent/run', {
    config: { rateLimit: { max: 2, timeWindow: '1 minute' } }
  }, async () => deps.triggerRun());
};
