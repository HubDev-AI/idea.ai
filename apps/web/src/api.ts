import type {
  AgentStatusRecord,
  AiHealthRecord,
  AiProviderHealthRecord,
  ConnectorStatusRecord as ConnectorRecord,
  ExecutionLogRecord,
  InfraStatusRecord,
  SignalPage,
  FeedRecord as SignalRecord,
  ThesisListItem,
  ThesisPage
} from '@idea/contracts/src/api';

export type {
  SignalRecord,
  SignalPage,
  ConnectorRecord,
  ExecutionLogRecord,
  AiProviderHealthRecord,
  AiHealthRecord,
  ThesisListItem,
  ThesisPage,
  AgentStatusRecord,
  InfraStatusRecord
};

const resolveApiBaseUrl = (): string => {
  const maybeEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const raw = maybeEnv?.VITE_API_URL ?? '';

  return raw.replace(/\/+$/, '');
};

const API_BASE_URL = resolveApiBaseUrl();

export const buildApiUrl = (path: string): string => `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

export const fetchSignals = async ({
  page = 1,
  pageSize = 20,
  window: timeWindow = '7d',
  source,
  thesisKey,
}: {
  page?: number;
  pageSize?: number;
  window?: string;
  source?: string;
  thesisKey?: string;
} = {}): Promise<SignalPage> => {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  params.set('window', timeWindow);
  if (source) params.set('source', source);
  if (thesisKey) params.set('thesis_key', thesisKey);
  const res = await fetch(buildApiUrl(`/v1/signals?${params.toString()}`));
  if (!res.ok) throw new Error(`fetchSignals failed: ${res.status}`);
  return res.json();
};

export const fetchConnectors = async (): Promise<ConnectorRecord[]> => {
  const response = await fetch(buildApiUrl('/v1/connectors'));
  if (!response.ok) {
    throw new Error('Failed to load connectors');
  }

  return response.json() as Promise<ConnectorRecord[]>;
};

export const fetchLogs = async ({
  limit = 200,
  level,
  runId
}: {
  limit?: number;
  level?: ExecutionLogRecord['level'];
  runId?: string;
} = {}): Promise<ExecutionLogRecord[]> => {
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.floor(limit)))
  });

  if (level) {
    params.set('level', level);
  }

  if (runId) {
    params.set('run_id', runId);
  }

  const response = await fetch(buildApiUrl(`/v1/logs?${params.toString()}`));
  if (!response.ok) {
    throw new Error('Failed to load execution logs');
  }

  return response.json() as Promise<ExecutionLogRecord[]>;
};

export const fetchAiHealth = async (): Promise<AiHealthRecord> => {
  const response = await fetch(buildApiUrl('/v1/ai-health'));
  if (!response.ok) {
    throw new Error('Failed to load ai health');
  }

  return response.json() as Promise<AiHealthRecord>;
};

export const fetchTheses = async ({
  page = 1,
  pageSize = 10,
  status
}: {
  page?: number;
  pageSize?: number;
  status?: string;
} = {}): Promise<ThesisPage | ThesisListItem[]> => {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  if (status) params.set('status', status);
  const response = await fetch(buildApiUrl(`/v1/theses?${params.toString()}`));
  if (!response.ok) throw new Error('Failed to load theses');
  return response.json() as Promise<ThesisPage | ThesisListItem[]>;
};

export const fetchAgentStatus = async (): Promise<AgentStatusRecord> => {
  const response = await fetch(buildApiUrl('/v1/agent/status'));
  if (!response.ok) throw new Error('Failed to load agent status');
  return response.json() as Promise<AgentStatusRecord>;
};

export type AgentRunResult = {
  thesesUpdated: number;
  newCandidates: number;
  alerts: string[];
  investigateNext: string;
  journalEntriesWritten: number;
  clustersAnalyzed: number;
  deepDivesPerformed: number;
};

export const triggerAgentRun = async (): Promise<AgentRunResult> => {
  const response = await fetch(buildApiUrl('/v1/agent/run'), {
    method: 'POST',
    signal: AbortSignal.timeout(300_000)
  });
  if (!response.ok) throw new Error('Failed to trigger agent run');
  return response.json() as Promise<AgentRunResult>;
};

export const fetchSignalCounts = async (): Promise<Record<string, number>> => {
  const response = await fetch(buildApiUrl('/v1/signals/counts'));
  if (!response.ok) throw new Error('Failed to load signal counts');
  return response.json() as Promise<Record<string, number>>;
};

export const fetchInfraStatus = async (): Promise<InfraStatusRecord> => {
  const response = await fetch(buildApiUrl('/v1/infra/status'));
  if (!response.ok) throw new Error('Failed to load infra status');
  return response.json() as Promise<InfraStatusRecord>;
};
