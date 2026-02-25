export type SignalRecord = {
  idea: string;
  score: number;
  top_source: string;
  snippet: string;
  source_url: string | null;
  next_action: 'validate_demand' | 'validate_pricing' | 'validate_channel';
  updated_at: string;
  // V2 score breakdown & reasoning
  pain?: number;
  timing?: number;
  buildability?: number;
  reasoning?: string;
};

export type SignalPage = {
  items: SignalRecord[];
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
};

export type ConnectorRecord = {
  name: string;
  status: 'active' | 'disabled' | 'error';
  last_run: string | null;
};

export type ExecutionLogRecord = {
  ts: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  run_id: string;
  component: string;
  message: string;
  context?: Record<string, unknown>;
};

export type AiProviderHealthRecord = {
  provider: 'claude' | 'codex';
  enabled: boolean;
  status: 'disabled' | 'idle' | 'healthy' | 'degraded' | 'error';
  attempted: number;
  succeeded: number;
  failed: number;
  retries: number;
  last_error: string | null;
};

export type AiHealthRecord = {
  run_id: string | null;
  refreshed_at: string | null;
  provider_setting: 'claude' | 'codex' | 'both';
  judge_mode: 'single' | 'ensemble';
  fallback_enabled: boolean;
  retry_budget: number;
  post_scrape_enabled: boolean;
  post_scrape_max_signals: number;
  judge_max_signals: number;
  providers: AiProviderHealthRecord[];
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
  pageSize = 8
}: {
  page?: number;
  pageSize?: number;
} = {}): Promise<SignalPage> => {
  const params = new URLSearchParams({
    page: String(Math.max(1, Math.floor(page))),
    page_size: String(Math.max(1, Math.floor(pageSize)))
  });
  const response = await fetch(buildApiUrl(`/v1/signals?${params.toString()}`));
  if (!response.ok) {
    throw new Error('Failed to load signals');
  }

  return response.json() as Promise<SignalPage>;
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

export type ThesisListItem = {
  canonicalKey: string;
  title: string;
  confidence: number;
  status: string;
  evidenceCount: number;
  problemStatement: string;
  sourceCount: number;
};

export type AgentStatusRecord = {
  lastRun: {
    timestamp: string;
    thesesUpdated: number;
    newCandidates: number;
  } | null;
  investigateNext: string | null;
};

export const fetchTheses = async (): Promise<ThesisListItem[]> => {
  const response = await fetch(buildApiUrl('/v1/theses'));
  if (!response.ok) throw new Error('Failed to load theses');
  return response.json() as Promise<ThesisListItem[]>;
};

export const fetchAgentStatus = async (): Promise<AgentStatusRecord> => {
  const response = await fetch(buildApiUrl('/v1/agent/status'));
  if (!response.ok) throw new Error('Failed to load agent status');
  return response.json() as Promise<AgentStatusRecord>;
};
