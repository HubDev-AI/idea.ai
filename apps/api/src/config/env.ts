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
  phApiToken?: string;
  noiseGateBatchSize: number;
  agentScheduleCron: string;
  agentDualAnalyst: boolean;
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const loadRuntimeEnv = (env: NodeJS.ProcessEnv = process.env): RuntimeEnv => ({
  databaseUrl: env.DATABASE_URL,
  hourlyConnectors: parseCsv(env.HOURLY_CONNECTORS, ['hn', 'github_issues', 'reddit']),
  dailyConnectors: parseCsv(env.DAILY_CONNECTORS, ['greenhouse', 'lever', 'yc_companies', 'producthunt']),
  greenhouseBoardToken: env.GREENHOUSE_BOARD_TOKEN,
  leverSite: env.LEVER_SITE,
  exaApiKey: env.EXA_API_KEY,
  perigonApiKey: env.PERIGON_API_KEY,
  exaDailyBudgetUsd: parseNumber(env.EXA_DAILY_BUDGET_USD, 5),
  perigonDailyBudgetUsd: parseNumber(env.PERIGON_DAILY_BUDGET_USD, 5),
  ollamaBaseUrl: env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  ollamaEmbedModel: env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text',
  redditSubreddits: parseCsv(env.REDDIT_SUBREDDITS, ['SaaS', 'startups', 'smallbusiness', 'Entrepreneur']),
  phApiToken: env.PH_API_TOKEN,
  noiseGateBatchSize: parseNumber(env.NOISE_GATE_BATCH_SIZE, 20),
  agentScheduleCron: env.AGENT_SCHEDULE_CRON ?? '0 */4 * * *',
  agentDualAnalyst: env.AGENT_DUAL_ANALYST === 'true'
});
