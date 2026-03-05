import type {
  AgentRunResult,
  AgentStatusRecord,
  AiHealthRecord,
  AiProviderHealthRecord,
  ConnectorStatusRecord as ConnectorRecord,
  ExecutionLogRecord,
  InfraStatusRecord,
  RefreshMeta,
  SignalPage,
  FeedRecord as SignalRecord,
  ThesisDeepDive,
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
  ThesisDeepDive,
  ThesisListItem,
  ThesisPage,
  AgentStatusRecord,
  InfraStatusRecord,
  AgentRunResult,
  RefreshMeta
};

const resolveApiBaseUrl = (): string => {
  const maybeEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const raw = maybeEnv?.VITE_API_URL ?? '';

  return raw.replace(/\/+$/, '');
};

const API_BASE_URL = resolveApiBaseUrl();

export const buildApiUrl = (path: string): string => `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

export type SortField = 'score' | 'newest' | 'virality' | 'demand';

export const fetchSignals = async ({
  page = 1,
  pageSize = 20,
  window: timeWindow = '7d',
  source,
  thesisKey,
  sort,
}: {
  page?: number;
  pageSize?: number;
  window?: string;
  source?: string;
  thesisKey?: string;
  sort?: SortField;
} = {}): Promise<SignalPage> => {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  params.set('window', timeWindow);
  if (source) params.set('source', source);
  if (thesisKey) params.set('thesis_key', thesisKey);
  if (sort) params.set('sort', sort);
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

export type ThesisSortField = 'score' | 'latest' | 'evidence' | 'newest';

export const fetchTheses = async ({
  page = 1,
  pageSize = 10,
  status,
  sort = 'score'
}: {
  page?: number;
  pageSize?: number;
  status?: string;
  sort?: ThesisSortField;
} = {}): Promise<ThesisPage> => {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  if (status) params.set('status', status);
  if (sort !== 'score') params.set('sort', sort);
  const response = await fetch(buildApiUrl(`/v1/theses?${params.toString()}`));
  if (!response.ok) throw new Error('Failed to load theses');
  const data = await response.json();

  // Normalize legacy flat array response to ThesisPage
  if (Array.isArray(data)) {
    return {
      items: data,
      page: 1,
      page_size: data.length,
      total_items: data.length,
      total_pages: 1,
      has_next: false,
      has_prev: false
    };
  }
  return data as ThesisPage;
};

export const fetchAgentStatus = async (): Promise<AgentStatusRecord> => {
  const response = await fetch(buildApiUrl('/v1/agent/status'));
  if (!response.ok) throw new Error('Failed to load agent status');
  return response.json() as Promise<AgentStatusRecord>;
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

export const fetchRefreshMeta = async (): Promise<RefreshMeta> => {
  const response = await fetch(buildApiUrl('/v1/connectors/refresh-meta'));
  if (!response.ok) throw new Error('Failed to load refresh meta');
  return response.json() as Promise<RefreshMeta>;
};

export const triggerConnectorRefresh = async (cadence?: 'hourly' | 'daily'): Promise<void> => {
  const url = cadence
    ? buildApiUrl(`/v1/connectors/refresh?cadence=${cadence}`)
    : buildApiUrl('/v1/connectors/refresh');
  const response = await fetch(url, { method: 'POST' });
  if (!response.ok) throw new Error('Failed to trigger refresh');
};

export const fetchThesisDeepDive = async (canonicalKey: string): Promise<ThesisDeepDive | null> => {
  const response = await fetch(buildApiUrl(`/v1/theses/${encodeURIComponent(canonicalKey)}/deep-dive`));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`fetchThesisDeepDive failed: ${response.status}`);
  return response.json() as Promise<ThesisDeepDive>;
};

export const generateThesisDeepDive = async (canonicalKey: string): Promise<ThesisDeepDive> => {
  const response = await fetch(
    buildApiUrl(`/v1/theses/${encodeURIComponent(canonicalKey)}/deep-dive`),
    { method: 'POST', signal: AbortSignal.timeout(120_000) }
  );
  if (!response.ok) throw new Error(`generateThesisDeepDive failed: ${response.status}`);
  return response.json() as Promise<ThesisDeepDive>;
};
