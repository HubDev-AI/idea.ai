import { loadRuntimeEnv } from '../config/env';

export type SchedulerPlan = {
  hourly: {
    cron: string;
    connectors: string[];
  };
  daily: {
    cron: string;
    connectors: string[];
  };
};

const isConnectorEnabled = (connector: string, env: ReturnType<typeof loadRuntimeEnv>): boolean => {
  if (connector === 'exa_byo') {
    return Boolean(env.exaApiKey);
  }

  if (connector === 'perigon_byo') {
    return Boolean(env.perigonApiKey);
  }

  return true;
};

export const buildSchedulerPlan = (rawEnv: NodeJS.ProcessEnv = process.env): SchedulerPlan => {
  const env = loadRuntimeEnv(rawEnv);

  return {
    hourly: {
      cron: '0 * * * *',
      connectors: env.hourlyConnectors.filter((connector) => isConnectorEnabled(connector, env))
    },
    daily: {
      cron: '0 0 * * *',
      connectors: env.dailyConnectors.filter((connector) => isConnectorEnabled(connector, env))
    }
  };
};
