import { Server as SocketIOServer } from 'socket.io';
import type {
  AgentStatusRecord,
  AiHealthRecord,
  ConnectorStatusRecord,
  ExecutionLogRecord,
  InfraStatusRecord,
  RefreshMeta,
  ThesisStats,
} from '@idea/contracts/src/api';
import type { AppSnapshot, ClientToServerEvents, ServerToClientEvents } from '@idea/contracts/src/ws';

type IO = SocketIOServer<ClientToServerEvents, ServerToClientEvents>;

export type StateHubDeps = {
  getConnectors: () => Promise<ConnectorStatusRecord[]>;
  getAiHealth: () => Promise<AiHealthRecord>;
  getAgentStatus: () => AgentStatusRecord;
  getInfraStatus: () => Promise<InfraStatusRecord>;
  getRefreshMeta: () => RefreshMeta;
  getSignalCounts: () => Promise<Record<string, number>>;
  getThesisStats: () => Promise<ThesisStats>;
  getLogs: () => Promise<ExecutionLogRecord[]>;
};

export class StateHub {
  private io: IO;
  private deps: StateHubDeps;
  private state: AppSnapshot;
  private infraTimer: ReturnType<typeof setInterval> | null = null;
  private logTimer: ReturnType<typeof setInterval> | null = null;
  private lastLogJson = '';
  private lastInfraJson = '';

  constructor(io: IO, deps: StateHubDeps) {
    this.io = io;
    this.deps = deps;
    this.state = {
      connectors: [],
      aiHealth: null,
      agentStatus: { isRunning: false, lastRun: null, investigateNext: null },
      infraStatus: null,
      refreshMeta: { last_hourly_run: null, last_daily_run: null, hourly_interval_ms: 3600000, daily_interval_ms: 86400000, refreshing: null },
      signalCounts: {},
      thesisStats: { total: 0, promoted: 0, watching: 0, totalEvidence: 0, totalSources: 0 },
      logs: [],
    };

    io.on('connection', (socket) => {
      socket.emit('snapshot', this.state);
    });
  }

  async collectAll(): Promise<void> {
    const [connectors, aiHealth, infraStatus, signalCounts, thesisStats, logs] = await Promise.allSettled([
      this.deps.getConnectors(),
      this.deps.getAiHealth(),
      this.deps.getInfraStatus(),
      this.deps.getSignalCounts(),
      this.deps.getThesisStats(),
      this.deps.getLogs(),
    ]);

    if (connectors.status === 'fulfilled') this.state.connectors = connectors.value;
    if (aiHealth.status === 'fulfilled') this.state.aiHealth = aiHealth.value;
    if (infraStatus.status === 'fulfilled') this.state.infraStatus = infraStatus.value;
    if (signalCounts.status === 'fulfilled') this.state.signalCounts = signalCounts.value;
    if (thesisStats.status === 'fulfilled') this.state.thesisStats = thesisStats.value;
    if (logs.status === 'fulfilled') this.state.logs = logs.value;

    this.state.agentStatus = this.deps.getAgentStatus();
    this.state.refreshMeta = this.deps.getRefreshMeta();
  }

  emitConnectors(data: ConnectorStatusRecord[]): void {
    this.state.connectors = data;
    this.io.emit('connectors', data);
  }

  emitAiHealth(data: AiHealthRecord): void {
    this.state.aiHealth = data;
    this.io.emit('aiHealth', data);
  }

  emitAgentStatus(data: AgentStatusRecord): void {
    this.state.agentStatus = data;
    this.io.emit('agentStatus', data);
  }

  emitRefreshMeta(data: RefreshMeta): void {
    this.state.refreshMeta = data;
    this.io.emit('refreshMeta', data);
  }

  emitSignalCounts(data: Record<string, number>): void {
    this.state.signalCounts = data;
    this.io.emit('signalCounts', data);
  }

  emitThesisStats(data: ThesisStats): void {
    this.state.thesisStats = data;
    this.io.emit('thesisStats', data);
  }

  emitSignalsUpdated(): void {
    this.io.emit('signalsUpdated');
  }

  emitThesesUpdated(): void {
    this.io.emit('thesesUpdated');
  }

  /** Broadcast all current state after a refresh or agent run */
  async broadcastAll(): Promise<void> {
    await this.collectAll();
    const s = this.state;
    this.io.emit('connectors', s.connectors);
    if (s.aiHealth) this.io.emit('aiHealth', s.aiHealth);
    this.io.emit('agentStatus', s.agentStatus);
    if (s.infraStatus) this.io.emit('infraStatus', s.infraStatus);
    this.io.emit('refreshMeta', s.refreshMeta);
    this.io.emit('signalCounts', s.signalCounts);
    this.io.emit('thesisStats', s.thesisStats);
    this.io.emit('signalsUpdated');
  }

  /** Push current refreshMeta to all clients (call when refresh starts/ends) */
  pushRefreshMeta(): void {
    const meta = this.deps.getRefreshMeta();
    this.state.refreshMeta = meta;
    this.io.emit('refreshMeta', meta);
  }

  /** Start background polling for infra stats (10s) and logs (3s) */
  startPolling(): void {
    this.infraTimer = setInterval(() => void this.pollInfra(), 10_000);
    this.logTimer = setInterval(() => void this.pollLogs(), 3_000);
  }

  stopPolling(): void {
    if (this.infraTimer) clearInterval(this.infraTimer);
    if (this.logTimer) clearInterval(this.logTimer);
  }

  private async pollInfra(): Promise<void> {
    try {
      const infra = await this.deps.getInfraStatus();
      const json = JSON.stringify(infra);
      if (json !== this.lastInfraJson) {
        this.lastInfraJson = json;
        this.state.infraStatus = infra;
        this.io.emit('infraStatus', infra);
      }
    } catch { /* infra check failed, skip */ }
  }

  private async pollLogs(): Promise<void> {
    try {
      const logs = await this.deps.getLogs();
      const json = JSON.stringify(logs);
      if (json !== this.lastLogJson) {
        this.lastLogJson = json;
        this.state.logs = logs;
        this.io.emit('logs', logs);
      }
    } catch { /* log read failed, skip */ }
  }
}
