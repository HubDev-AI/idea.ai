const parseCsv = (value: string | undefined, fallback: string[]): string[] =>
  (value ?? fallback.join(','))
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export type RuntimeEnv = {
  databaseUrl?: string;
  hourlyConnectors: string[];
  dailyConnectors: string[];
  greenhouseBoardToken?: string;
  leverSite?: string;
  exaApiKey?: string;
  perigonApiKey?: string;
  exaDailyBudgetUsd: number;
  perigonDailyBudgetUsd: number;
  ollamaBaseUrl: string;
  ollamaEmbedModel: string;
  redditSubreddits: string[];
  b2bSubreddits: string[];
  phApiToken?: string;
  xBearerToken?: string;
  xDailyBudgetUsd: number;
  enableJobConnectors: boolean;
  noiseGateBatchSize: number;
  agentScheduleCron: string;
  agentDualAnalyst: boolean;
  agentIntervalMs: number;
  agentTimeoutMs: number;
  agentMaxClusters: number;
  shutdownTimeoutMs: number;
  wsInfraPollMs: number;
  wsLogPollMs: number;
  cleanupIntervalMs: number;
  retentionDays: number;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMs: number;
  bayesianPriorDefault: number;
  bayesianDecayRate: number;
  bayesianDecayAfterDays: number;
  bayesianFloorConfidence: number;
  debateConfidenceThreshold: number;
  debateMaxPerRun: number;
  backtestSnapshotIntervalMs: number;
  backtestValidateAfterDays: number;
  cusumThreshold: number;
  cusumDrift: number;
  categoryMinPhraseCount: number;
  modelRoutingEnabled: boolean;
  ollamaCheapModel: string;
  ollamaMediumModel: string;
  ollamaTaskTimeoutMs: number;
  weightOptEnabled: boolean;
  weightOptIntervalMs: number;
  weightOptMinPredictions: number;
  weightOptMinImprovement: number;
  weightOptGridStep: number;
  entityExtractBatchSize: number;
  aiProvider: 'claude' | 'codex' | 'both';
  aiProviderPrimary: 'claude' | 'codex';
  aiProviderFallback: boolean;
  aiProviderRetries: number;
  connectorConcurrency: number;
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const loadRuntimeEnv = (env: NodeJS.ProcessEnv = process.env): RuntimeEnv => {
  const result: RuntimeEnv = {
    hourlyConnectors: parseCsv(env.HOURLY_CONNECTORS, ['hn', 'github_issues', 'reddit']),
    dailyConnectors: parseCsv(env.DAILY_CONNECTORS, ['greenhouse', 'lever', 'yc_companies', 'producthunt', 'appstore_trending', 'indiehackers', 'google_trends']),
    exaDailyBudgetUsd: parseNumber(env.EXA_DAILY_BUDGET_USD, 5),
    perigonDailyBudgetUsd: parseNumber(env.PERIGON_DAILY_BUDGET_USD, 5),
    ollamaBaseUrl: env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
    ollamaEmbedModel: env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text',
    redditSubreddits: parseCsv(env.REDDIT_SUBREDDITS, ['SaaS', 'startups', 'smallbusiness', 'Entrepreneur', 'apps', 'socialmedia', 'productivity', 'dating', 'sideproject', 'AppIdeas', 'InternetIsBeautiful']),
    b2bSubreddits: parseCsv(env.B2B_SUBREDDITS, ['devops', 'sysadmin', 'ITManagers', 'msp', 'salesforce', 'aws', 'googlecloud', 'azure', 'ExperiencedDevs']),
    xDailyBudgetUsd: parseNumber(env.X_DAILY_BUDGET_USD, 0),
    enableJobConnectors: env.ENABLE_JOB_CONNECTORS === 'true',
    noiseGateBatchSize: parseNumber(env.NOISE_GATE_BATCH_SIZE, 20),
    agentScheduleCron: env.AGENT_SCHEDULE_CRON ?? '0 */4 * * *',
    agentDualAnalyst: env.AGENT_DUAL_ANALYST === 'true',
    agentIntervalMs: parseNumber(env.AGENT_INTERVAL_MS, 60 * 60 * 1000),
    agentTimeoutMs: parseNumber(env.AGENT_TIMEOUT_MS, 180_000),
    agentMaxClusters: parseNumber(env.AGENT_MAX_CLUSTERS, 50),
    shutdownTimeoutMs: parseNumber(env.SHUTDOWN_TIMEOUT_MS, 15_000),
    wsInfraPollMs: parseNumber(env.WS_INFRA_POLL_MS, 10_000),
    wsLogPollMs: parseNumber(env.WS_LOG_POLL_MS, 3_000),
    cleanupIntervalMs: parseNumber(env.CLEANUP_INTERVAL_MS, 6 * 60 * 60 * 1000),
    retentionDays: parseNumber(env.RETENTION_DAYS, 90),
    circuitBreakerThreshold: parseNumber(env.CIRCUIT_BREAKER_THRESHOLD, 3),
    circuitBreakerCooldownMs: parseNumber(env.CIRCUIT_BREAKER_COOLDOWN_MS, 10 * 60 * 1000),
    bayesianPriorDefault: parseNumber(env.BAYESIAN_PRIOR_DEFAULT, 20),
    bayesianDecayRate: parseNumber(env.BAYESIAN_DECAY_RATE, 0.97),
    bayesianDecayAfterDays: parseNumber(env.BAYESIAN_DECAY_AFTER_DAYS, 14),
    bayesianFloorConfidence: parseNumber(env.BAYESIAN_FLOOR_CONFIDENCE, 5),
    debateConfidenceThreshold: parseNumber(env.DEBATE_CONFIDENCE_THRESHOLD, 40),
    debateMaxPerRun: parseNumber(env.DEBATE_MAX_PER_RUN, 5),
    backtestSnapshotIntervalMs: parseNumber(env.BACKTEST_SNAPSHOT_INTERVAL_MS, 7 * 24 * 60 * 60 * 1000),
    backtestValidateAfterDays: parseNumber(env.BACKTEST_VALIDATE_AFTER_DAYS, 30),
    cusumThreshold: parseNumber(env.CUSUM_THRESHOLD, 5),
    cusumDrift: parseNumber(env.CUSUM_DRIFT, 1),
    categoryMinPhraseCount: parseNumber(env.CATEGORY_MIN_PHRASE_COUNT, 3),
    modelRoutingEnabled: env.MODEL_ROUTING_ENABLED === 'true',
    ollamaCheapModel: env.OLLAMA_CHEAP_MODEL ?? 'llama3.2:3b',
    ollamaMediumModel: env.OLLAMA_MEDIUM_MODEL ?? 'qwen2.5:7b',
    ollamaTaskTimeoutMs: parseNumber(env.OLLAMA_TASK_TIMEOUT_MS, 30_000),
    weightOptEnabled: env.WEIGHT_OPT_ENABLED !== 'false',
    weightOptIntervalMs: parseNumber(env.WEIGHT_OPT_INTERVAL_MS, 7 * 24 * 60 * 60 * 1000),
    weightOptMinPredictions: parseNumber(env.WEIGHT_OPT_MIN_PREDICTIONS, 50),
    weightOptMinImprovement: parseNumber(env.WEIGHT_OPT_MIN_IMPROVEMENT, 0.05),
    weightOptGridStep: parseNumber(env.WEIGHT_OPT_GRID_STEP, 0.05),
    entityExtractBatchSize: parseNumber(env.ENTITY_EXTRACT_BATCH_SIZE, 10),
    aiProvider: (env.AI_PROVIDER?.toLowerCase() === 'codex' ? 'codex' : env.AI_PROVIDER?.toLowerCase() === 'both' ? 'both' : 'claude') as RuntimeEnv['aiProvider'],
    aiProviderPrimary: env.AI_PROVIDER_PRIMARY?.toLowerCase() === 'codex' ? 'codex' : 'claude',
    aiProviderFallback: env.AI_PROVIDER_FALLBACK === 'true',
    aiProviderRetries: parseNumber(env.AI_PROVIDER_RETRIES, 1),
    connectorConcurrency: parseNumber(env.CONNECTOR_CONCURRENCY, 5),
  };
  if (env.DATABASE_URL !== undefined) result.databaseUrl = env.DATABASE_URL;
  if (env.GREENHOUSE_BOARD_TOKEN !== undefined) result.greenhouseBoardToken = env.GREENHOUSE_BOARD_TOKEN;
  if (env.LEVER_SITE !== undefined) result.leverSite = env.LEVER_SITE;
  if (env.EXA_API_KEY !== undefined) result.exaApiKey = env.EXA_API_KEY;
  if (env.PERIGON_API_KEY !== undefined) result.perigonApiKey = env.PERIGON_API_KEY;
  if (env.PH_API_TOKEN !== undefined) result.phApiToken = env.PH_API_TOKEN;
  if (env.X_BEARER_TOKEN !== undefined) result.xBearerToken = env.X_BEARER_TOKEN;
  return result;
};
