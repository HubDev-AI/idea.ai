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
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const loadRuntimeEnv = (env: NodeJS.ProcessEnv = process.env): RuntimeEnv => ({
  databaseUrl: env.DATABASE_URL,
  hourlyConnectors: parseCsv(env.HOURLY_CONNECTORS, ['hn', 'github_issues']),
  dailyConnectors: parseCsv(env.DAILY_CONNECTORS, ['greenhouse', 'lever', 'yc_companies']),
  greenhouseBoardToken: env.GREENHOUSE_BOARD_TOKEN,
  leverSite: env.LEVER_SITE,
  exaApiKey: env.EXA_API_KEY,
  perigonApiKey: env.PERIGON_API_KEY,
  exaDailyBudgetUsd: parseNumber(env.EXA_DAILY_BUDGET_USD, 5),
  perigonDailyBudgetUsd: parseNumber(env.PERIGON_DAILY_BUDGET_USD, 5)
});
