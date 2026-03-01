/* ------------------------------------------------------------------ */
/*  Shared API types used by both the API server and web client        */
/* ------------------------------------------------------------------ */

// -- Feed / Signals ------------------------------------------------ */

export type FeedRecord = {
  idea: string;
  score: number;
  top_source: string;
  snippet: string;
  source_url: string | null;
  next_action: 'validate_demand' | 'validate_pricing' | 'validate_channel';
  updated_at: string;
  pain?: number;
  timing?: number;
  buildability?: number;
  reasoning?: string;
};

export type SignalPage = {
  items: FeedRecord[];
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
};

/**
 * @deprecated Use {@link SignalPage} instead. Kept as an alias for
 * backwards-compatibility with existing API-side code.
 */
export type PaginatedFeedResponse = SignalPage;

// -- Connectors ---------------------------------------------------- */

export type ConnectorStatusRecord = {
  name: string;
  status: 'active' | 'disabled' | 'error';
  last_run: string | null;
};

// -- Execution logs ------------------------------------------------ */

export type ExecutionLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type ExecutionLogRecord = {
  ts: string;
  level: ExecutionLogLevel;
  run_id: string;
  component: string;
  message: string;
  context?: Record<string, unknown>;
};

export type ListLogsQuery = {
  limit: number;
  level?: ExecutionLogLevel;
  run_id?: string;
  scope?: 'session' | 'all';
};

// -- AI health ----------------------------------------------------- */

export type AiProviderName = 'claude' | 'codex';
export type AiProviderStatus = 'disabled' | 'idle' | 'healthy' | 'degraded' | 'error';

export type AiProviderHealthRecord = {
  provider: AiProviderName;
  enabled: boolean;
  status: AiProviderStatus;
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

// -- Theses / Research agent --------------------------------------- */

export type ThesisListItem = {
  canonicalKey: string;
  title: string;
  confidence: number;
  status: string;
  evidenceCount: number;
  problemStatement: string;
  sourceCount: number;
  estimatedScope: 'small' | 'medium' | 'large' | null;
};

export type ThesisPage = {
  items: ThesisListItem[];
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
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

export type AgentStatusRecord = {
  lastRun: {
    timestamp: string;
    thesesUpdated: number;
    newCandidates: number;
    clustersAnalyzed: number;
    deepDivesPerformed: number;
    journalEntriesWritten: number;
  } | null;
  investigateNext: string | null;
};

export type InfraStatusRecord = {
  postgres: 'ok' | 'error';
  ollama: 'ok' | 'error';
  embeddings: {
    total: number;
    withEmbedding: number;
    fallbackModel: string;
  };
};
