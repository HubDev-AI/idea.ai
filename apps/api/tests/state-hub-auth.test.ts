import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioc } from 'socket.io-client';
import { StateHub } from '../src/ws/state_hub';
import type { StateHubDeps, StateHubConfig } from '../src/ws/state_hub';

const makeStubDeps = (): StateHubDeps => ({
  getConnectors: async () => [],
  getAiHealth: async () => ({ providers: [], refreshed_at: null }),
  getAgentStatus: () => ({ isRunning: false, intervalMs: 0, activeRunId: null, lastRun: null, lastAttempt: null, investigateNext: null }),
  getInfraStatus: async () => ({ postgres: 'ok' as const, ollama: 'ok' as const, embeddings: { total: 0, withEmbedding: 0, fallbackModel: 'none' } }),
  getRefreshMeta: () => ({ last_hourly_run: null, last_daily_run: null, hourly_interval_ms: 3600000, daily_interval_ms: 86400000, refreshing: null }),
  getSignalCounts: async () => ({}),
  getSignalCount: async () => 0,
  getLatestSignalAt: async () => null,
  getThesisStats: async () => ({ total: 0, promoted: 0, watching: 0, totalEvidence: 0, totalSources: 0 }),
  getLogs: async () => [],
});

const cfg: StateHubConfig = { infraPollMs: 999999, logPollMs: 999999 };

describe('StateHub auth', () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: SocketIOServer;
  let port: number;

  beforeEach(async () => {
    httpServer = createServer();
    io = new SocketIOServer(httpServer, { cors: { origin: '*' } });
    await new Promise<void>((r) => httpServer.listen(0, () => r()));
    port = (httpServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    io.close();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  it('rejects socket connection when apiKey set and no key provided', async () => {
    new StateHub(io, makeStubDeps(), cfg, 'secret-key');

    const socket = ioc(`http://localhost:${port}`, { reconnection: false });
    const error = await new Promise<string>((resolve) => {
      socket.on('connect_error', (err) => resolve(err.message));
      socket.on('connect', () => resolve('connected'));
    });
    socket.disconnect();
    expect(error).toBe('Unauthorized');
  });

  it('accepts socket connection when apiKey set and correct key provided', async () => {
    new StateHub(io, makeStubDeps(), cfg, 'secret-key');

    const socket = ioc(`http://localhost:${port}`, {
      auth: { key: 'secret-key' },
      reconnection: false,
    });
    const result = await new Promise<string>((resolve) => {
      socket.on('connect', () => resolve('connected'));
      socket.on('connect_error', (err) => resolve(err.message));
    });
    socket.disconnect();
    expect(result).toBe('connected');
  });

  it('accepts socket connection when no apiKey set (open dev mode)', async () => {
    new StateHub(io, makeStubDeps(), cfg, undefined);

    const socket = ioc(`http://localhost:${port}`, { reconnection: false });
    const result = await new Promise<string>((resolve) => {
      socket.on('connect', () => resolve('connected'));
      socket.on('connect_error', (err) => resolve(err.message));
    });
    socket.disconnect();
    expect(result).toBe('connected');
  });
});
