import type {
  AgentStatusRecord,
  AiHealthRecord,
  ConnectorStatusRecord,
  ExecutionLogRecord,
  InfraStatusRecord,
  RefreshMeta,
  ThesisStats,
} from './api';

export type AppSnapshot = {
  connectors: ConnectorStatusRecord[];
  aiHealth: AiHealthRecord | null;
  agentStatus: AgentStatusRecord;
  infraStatus: InfraStatusRecord | null;
  refreshMeta: RefreshMeta;
  signalCounts: Record<string, number>;
  signalCount: number;
  latestSignalAt: string | null;
  thesisStats: ThesisStats;
  logs: ExecutionLogRecord[];
};

export type ServerToClientEvents = {
  snapshot: (state: AppSnapshot) => void;
  connectors: (data: ConnectorStatusRecord[]) => void;
  aiHealth: (data: AiHealthRecord) => void;
  agentStatus: (data: AgentStatusRecord) => void;
  infraStatus: (data: InfraStatusRecord) => void;
  refreshMeta: (data: RefreshMeta) => void;
  signalCounts: (data: Record<string, number>) => void;
  thesisStats: (data: ThesisStats) => void;
  logs: (data: ExecutionLogRecord[]) => void;
  signalsUpdated: () => void;
  thesesUpdated: () => void;
};

export type ClientToServerEvents = Record<string, never>;
