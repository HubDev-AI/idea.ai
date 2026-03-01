import type { ByoConnectorResult } from '@idea/connectors/src/byo_guard';
import { runExaByoConnector } from '@idea/connectors/src/exa_byo';
import { runPerigonByoConnector } from '@idea/connectors/src/perigon_byo';
import { runTwitterByoConnector } from '@idea/connectors/src/twitter_byo';
import { createExecutionLogger, type ExecutionLogger } from '../runtime/execution_logger';

type ByoConnectorName = 'exa_byo' | 'perigon_byo' | 'twitter_byo';

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

export const runByoConnectorIngestion = async (
  env: NodeJS.ProcessEnv = process.env,
  deps: {
    runExa?: ConnectorExecutor;
    runPerigon?: ConnectorExecutor;
    runTwitter?: ConnectorExecutor;
    logger?: ExecutionLogger;
  } = {}
) => {
  const loggerOpts: Parameters<typeof createExecutionLogger>[0] = { env };
  if (env.RUN_ID !== undefined) loggerOpts.runId = env.RUN_ID;
  const logger = deps.logger ?? createExecutionLogger(loggerOpts);
  const runExa = deps.runExa ?? runExaByoConnector;
  const runPerigon = deps.runPerigon ?? runPerigonByoConnector;
  const runTwitter = deps.runTwitter ?? runTwitterByoConnector;
  const [exa, perigon, twitter] = await Promise.all([
    runSafely('exa_byo', env, runExa, logger),
    runSafely('perigon_byo', env, runPerigon, logger),
    runSafely('twitter_byo', env, runTwitter, logger)
  ]);

  await logger.info('ingest_byo', 'ingestion complete', {
    connectors: {
      exa: exa.status,
      perigon: perigon.status,
      twitter: twitter.status
    }
  });

  return {
    run_id: logger.runId,
    connectors: {
      exa,
      perigon,
      twitter
    }
  };
};
