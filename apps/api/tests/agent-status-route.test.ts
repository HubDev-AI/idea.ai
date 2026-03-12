import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

describe('POST /v1/agent/run', () => {
  it('returns the accepted run id immediately for websocket correlation', async () => {
    const app = await buildServer({
      getAgentStatus: () => ({
        isRunning: false,
        intervalMs: 60_000,
        activeRunId: null,
        lastRun: null,
        lastAttempt: null,
        investigateNext: null,
      }),
      triggerAgentRun: () => ({
        accepted: true,
        runId: 'agent-123',
        alreadyRunning: false,
      })
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent/run',
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      accepted: true,
      runId: 'agent-123',
      alreadyRunning: false,
    });
  });
});
