import { evaluateByoGuard, type ByoConnectorResult } from '@idea/connectors/src/byo_guard';
import { runExaByoConnector } from '@idea/connectors/src/exa_byo';
import { runPerigonByoConnector } from '@idea/connectors/src/perigon_byo';
import { runTwitterByoConnector } from '@idea/connectors/src/twitter_byo';
import { runSerpByoConnector, type SerpQuery } from '@idea/connectors/src/dataforseo_serp_byo';
import { createExecutionLogger, type ExecutionLogger } from '../runtime/execution_logger';

type ByoConnectorName = 'exa_byo' | 'perigon_byo' | 'twitter_byo' | 'dataforseo_serp_byo';

const COST_PER_CALL: Record<string, number> = {
  exa_byo: 0.01,
  perigon_byo: 0.01,
  twitter_byo: 0.02,
  // dataforseo_serp_byo cost is variable (batch size × depth × AIO flag);
  // set to 0 as sentinel — real cost tracked via R17 spend-preview telemetry on SerpConnectorResult.
  dataforseo_serp_byo: 0,
};

// Minimal smoke-test fixture for criterion validation before Language-First Pruning Gate ships.
// Production default is [] (no queries run until SerpQuery[] population is wired up).
const SMOKE_TEST_SERP_INPUTS: SerpQuery[] = [
  { keyword: 'salary calculator', country_code: 'DE', language_code: 'de' },
];

type ConnectorExecutor = (env: NodeJS.ProcessEnv) => Promise<ByoConnectorResult>;

const errorMessage = (value: unknown): string => (value instanceof Error ? value.message : 'Unknown error');

const toErroredResult = (connector: ByoConnectorName, error: unknown): ByoConnectorResult => ({
  status: 'error',
  error: errorMessage(error),
  events: [],
  telemetry: {
    connector,
    skipped: true,
    budget_usd: 0
  }
});

const runSafely = async (
  connector: ByoConnectorName,
  env: NodeJS.ProcessEnv,
  execute: ConnectorExecutor,
  logger: ExecutionLogger
): Promise<ByoConnectorResult> => {
  try {
    const result = await execute(env);

    await logger.info('ingest_byo', 'connector completed', {
      connector,
      status: result.status,
      events: result.events.length,
      reason: result.reason
    });

    return result;
  } catch (error) {
    const message = errorMessage(error);
    await logger.error('ingest_byo', 'connector failed', {
      connector,
      error: message
    });

    return toErroredResult(connector, error);
  }
};

const API_KEY_ENV: Record<ByoConnectorName, string> = {
  exa_byo: 'EXA_API_KEY',
  perigon_byo: 'PERIGON_API_KEY',
  twitter_byo: 'X_BEARER_TOKEN',
  dataforseo_serp_byo: 'DATAFORSEO_API_KEY',
};

const BUDGET_ENV: Record<ByoConnectorName, string> = {
  exa_byo: 'EXA_DAILY_BUDGET_USD',
  perigon_byo: 'PERIGON_DAILY_BUDGET_USD',
  twitter_byo: 'X_DAILY_BUDGET_USD',
  dataforseo_serp_byo: 'DATAFORSEO_DAILY_BUDGET_USD',
};

export const runByoConnectorIngestion = async (
  env: NodeJS.ProcessEnv = process.env,
  deps: {
    runExa?: ConnectorExecutor;
    runPerigon?: ConnectorExecutor;
    runTwitter?: ConnectorExecutor;
    runSerp?: ConnectorExecutor;
    serpInputs?: SerpQuery[];
    logger?: ExecutionLogger;
    spendStore?: { record(connector: string, amount: number): Promise<void>; getSpent(connector: string): Promise<number> };
  } = {}
) => {
  const loggerOpts: Parameters<typeof createExecutionLogger>[0] = { env };
  if (env.RUN_ID !== undefined) loggerOpts.runId = env.RUN_ID;
  const logger = deps.logger ?? createExecutionLogger(loggerOpts);
  const runExa = deps.runExa ?? runExaByoConnector;
  const runPerigon = deps.runPerigon ?? runPerigonByoConnector;
  const runTwitter = deps.runTwitter ?? runTwitterByoConnector;
  const serpInputs = deps.serpInputs ?? [];
  const runSerp = deps.runSerp ?? ((e) => runSerpByoConnector(serpInputs, e));

  const runWithSpend = async (
    connector: ByoConnectorName,
    execute: ConnectorExecutor
  ): Promise<ByoConnectorResult> => {
    if (deps.spendStore) {
      const spent = await deps.spendStore.getSpent(connector);
      const apiKey = env[API_KEY_ENV[connector]];
      const budgetValue = env[BUDGET_ENV[connector]];
      const guard = evaluateByoGuard({
        connector,
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(budgetValue !== undefined ? { budgetValue } : {}),
        fallbackBudget: 5,
        spentUsd: spent,
      });
      if (!guard.allowed) {
        return { status: 'skipped', reason: guard.reason, events: [], telemetry: guard.telemetry };
      }
    }

    const result = await runSafely(connector, env, execute, logger);

    if (result.status === 'active' && deps.spendStore) {
      await deps.spendStore.record(connector, COST_PER_CALL[connector] ?? 0.01);
    }

    return result;
  };

  const [exa, perigon, twitter, serp] = await Promise.all([
    runWithSpend('exa_byo', runExa),
    runWithSpend('perigon_byo', runPerigon),
    runWithSpend('twitter_byo', runTwitter),
    runWithSpend('dataforseo_serp_byo', runSerp),
  ]);

  await logger.info('ingest_byo', 'ingestion complete', {
    connectors: {
      exa: exa.status,
      perigon: perigon.status,
      twitter: twitter.status,
      serp: serp.status,
    }
  });

  return {
    run_id: logger.runId,
    connectors: {
      exa,
      perigon,
      twitter,
      dataforseo_serp_byo: serp,
    }
  };
};
