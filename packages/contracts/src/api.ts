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
  demand?: number;
  timing?: number;
  buildability?: number;
  virality?: number;
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
  cadence: 'hourly' | 'daily' | null;
};

export type RefreshMeta = {
  last_hourly_run: string | null;
  last_daily_run: string | null;
  hourly_interval_ms: number;
  daily_interval_ms: number;
  refreshing: {
    hourly: boolean;
    daily: boolean;
  };
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
  component?: string;
};

// -- AI health ----------------------------------------------------- */

export type AiProviderName = 'claude' | 'codex';
export type AiProviderStatus = 'disabled' | 'idle' | 'healthy' | 'degraded' | 'error';

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export type AiProviderHealthRecord = {
  provider: AiProviderName;
  enabled: boolean;
  status: AiProviderStatus;
  attempted: number;
  succeeded: number;
  failed: number;
  retries: number;
  last_error: string | null;
  circuit_state?: CircuitBreakerState;
  circuit_failures?: number;
};

export type AiHealthRecord = {
  run_id: string | null;
  refreshed_at: string | null;
  provider_setting: 'claude' | 'codex' | 'both';
  primary_provider: AiProviderName;
  judge_mode: 'single' | 'ensemble';
  fallback_enabled: boolean;
  retry_budget: number;
  post_scrape_enabled: boolean;
  post_scrape_max_signals: number;
  judge_max_signals: number;
  providers: AiProviderHealthRecord[];
  routerStats?: {
    ollamaCalls: number;
    ollamaSucceeded: number;
    cliCalls: number;
    cliSucceeded: number;
    fallbacks: number;
    routingEnabled: boolean;
  };
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
  firstSeenAt: string;
  lastSeenAt: string;
  hasDeepDive: boolean;
  profileId?: string;
  label: 'favourite' | 'later' | 'dismissed' | null;
  posteriorConfidence?: number;
  velocity?: number;
  corroborationScore?: number;
  debateVerdict?: 'strong_opportunity' | 'needs_investigation' | 'contested' | 'likely_noise' | null;
  categoryEmerging?: boolean;
  supplyDemand?: 'opportunity' | 'competitive' | 'niche' | 'saturated' | null;
};

export type ThesisStats = {
  total: number;
  promoted: number;
  watching: number;
  totalEvidence: number;
  totalSources: number;
};

export type ThesisPage = {
  items: ThesisListItem[];
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  stats: ThesisStats;
};

export type ThesisDeepDive = {
  canonicalKey: string;
  summary: string;
  howItWorks: string;
  growthStrategy: string;
  buildSuggestions: string;
  generatedBy: string;
  createdAt: string;
};

export type ThesisExplainRecord = {
  weightBreakdown: {
    demand: { score: number; weight: number; contribution: number };
    timing: { score: number; weight: number; contribution: number };
    buildability: { score: number; weight: number; contribution: number };
    virality: { score: number; weight: number; contribution: number };
    dimensionLabels: {
      demand: string;
      timing: string;
      buildability: string;
      virality: string;
    };
    blended: number;
    weightsSource: 'optimized' | 'default';
  };
  debate: {
    bullCase: string;
    bearCase: string;
    verdict: string;
    confidence: number;
    bullStrength: number;
    bearStrength: number;
    missingEvidence: string[];
    debatedAt: string;
  } | null;
  bayesianTrail: {
    prior: number;
    posterior: number;
    updates: { source: string; delta: number; at: string }[];
  };
  topEvidence: {
    signalId: string;
    text: string;
    source: string;
    score: number;
  }[];
};

export type AgentRunResult = {
  thesesUpdated: number;
  newCandidates: number;
  alerts: string[];
  investigateNext: string;
  journalEntriesWritten: number;
  clustersAnalyzed: number;
  deepDivesPerformed: number;
  debatesPerformed?: number;
  provider: string | null;
};

export type AgentRunAccepted = {
  accepted: boolean;
  runId: string;
  alreadyRunning: boolean;
};

export type AgentStatusRecord = {
  isRunning: boolean;
  intervalMs: number;
  activeRunId: string | null;
  lastRun: {
    timestamp: string;
    thesesUpdated: number;
    newCandidates: number;
    clustersAnalyzed: number;
    deepDivesPerformed: number;
    journalEntriesWritten: number;
    provider: string | null;
  } | null;
  lastAttempt: {
    runId: string;
    timestamp: string;
    status: 'running' | 'completed' | 'failed';
    provider: string | null;
    errorMessage: string | null;
  } | null;
  investigateNext: string | null;
};

export type InfraStatusRecord = {
  postgres: 'ok' | 'error';
  ollama: 'ok' | 'error';
  ollamaSizeMb?: number;
  embeddings: {
    total: number;
    withEmbedding: number;
    fallbackModel: string;
    dataSizeMb?: number;
  };
  diskUsage?: {
    dbSizeMb: number;
    tableSizes: { name: string; sizeMb: number; rows: number }[];
  };
};

export type OpportunityNode = {
  id: string;
  label: string;
  type: 'market' | 'category' | 'thesis';
  confidence: number;
  velocity: number;
  supply: number;
  demand: number;
  supplyDemand?: 'opportunity' | 'competitive' | 'niche' | 'saturated' | null;
  emerging?: boolean;
  problemStatement?: string;
  status?: string;
  scoreTotal?: number;
  children?: OpportunityNode[];
};

export type OpportunityMapRecord = {
  roots: OpportunityNode[];
  generatedAt: string;
};

export type EntityRecord = {
  id: number;
  entityType: string;
  name: string;
  description: string | null;
  mentionCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  relations: {
    relationType: string;
    targetName: string;
    targetType: string;
    confidence: number;
  }[];
};

export type EntityInsights = {
  unaddressedPains: { name: string; mentionCount: number; description: string | null }[];
  emergingTech: { name: string; mentionCount: number; description: string | null }[];
  totalEntities: number;
  totalRelations: number;
};

export type ScoringHealthRecord = {
  currentWeights: {
    profileId: string;
    demand: number;
    timing: number;
    buildability: number;
    virality: number;
    source: 'optimized' | 'default';
  };
  optimizationHistory: {
    computedAt: string;
    demand: number;
    timing: number;
    buildability: number;
    virality: number;
    precision: number | null;
    sampleSize: number | null;
  }[];
  predictionTrackRecord: {
    total: number;
    validated: number;
    accuracy: number | null;
  };
  experienceLibrarySize: number;
};
