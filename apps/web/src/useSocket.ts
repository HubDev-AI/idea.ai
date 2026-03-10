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
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type SocketState = {
  connected: boolean;
  connectors: ConnectorStatusRecord[];
  aiHealth: AiHealthRecord | null;
  agentStatus: AgentStatusRecord | null;
  infraStatus: InfraStatusRecord | null;
  refreshMeta: RefreshMeta | null;
  signalCounts: Record<string, number>;
  signalCount: number;
  latestSignalAt: string | null;
  thesisStats: ThesisStats;
  logs: ExecutionLogRecord[];
  signalsUpdatedAt: number;
  thesesUpdatedAt: number;
};

const EMPTY_STATS: ThesisStats = { total: 0, promoted: 0, watching: 0, totalEvidence: 0, totalSources: 0 };

export const useSocket = (): SocketState => {
  const [connected, setConnected] = useState(false);
  const [connectors, setConnectors] = useState<ConnectorStatusRecord[]>([]);
  const [aiHealth, setAiHealth] = useState<AiHealthRecord | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatusRecord | null>(null);
  const [infraStatus, setInfraStatus] = useState<InfraStatusRecord | null>(null);
  const [refreshMeta, setRefreshMeta] = useState<RefreshMeta | null>(null);
  const [signalCounts, setSignalCounts] = useState<Record<string, number>>({});
  const [signalCount, setSignalCount] = useState(0);
  const [latestSignalAt, setLatestSignalAt] = useState<string | null>(null);
  const [thesisStats, setThesisStats] = useState<ThesisStats>(EMPTY_STATS);
  const [logs, setLogs] = useState<ExecutionLogRecord[]>([]);
  const [signalsUpdatedAt, setSignalsUpdatedAt] = useState(0);
  const [thesesUpdatedAt, setThesesUpdatedAt] = useState(0);
  const socketRef = useRef<TypedSocket | null>(null);

  useEffect(() => {
    const apiKey =
      (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
        ?.VITE_API_KEY ?? '';

    const maybeEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    const apiUrl = maybeEnv?.VITE_API_URL ?? '';

    const socket: TypedSocket = io(apiUrl || undefined, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      ...(apiKey ? { auth: { key: apiKey } } : {}),
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('snapshot', (state: AppSnapshot) => {
      setConnectors(state.connectors);
      setAiHealth(state.aiHealth);
      setAgentStatus(state.agentStatus);
      setInfraStatus(state.infraStatus);
      setRefreshMeta(state.refreshMeta);
      setSignalCounts(state.signalCounts);
      setSignalCount(state.signalCount);
      setLatestSignalAt(state.latestSignalAt);
      setThesisStats(state.thesisStats);
      setLogs(state.logs);
    });

    socket.on('connectors', setConnectors);
    socket.on('aiHealth', setAiHealth);
    socket.on('agentStatus', setAgentStatus);
    socket.on('infraStatus', setInfraStatus);
    socket.on('refreshMeta', setRefreshMeta);
    socket.on('signalCounts', setSignalCounts);
    socket.on('signalCount', setSignalCount);
    socket.on('latestSignalAt', setLatestSignalAt);
    socket.on('thesisStats', setThesisStats);
    socket.on('logs', setLogs);
    socket.on('signalsUpdated', () => setSignalsUpdatedAt(Date.now()));
    socket.on('thesesUpdated', () => setThesesUpdatedAt(Date.now()));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return {
    connected,
    connectors,
    aiHealth,
    agentStatus,
    infraStatus,
    refreshMeta,
    signalCounts,
    signalCount,
    latestSignalAt,
    thesisStats,
    logs,
    signalsUpdatedAt,
    thesesUpdatedAt,
  };
};
