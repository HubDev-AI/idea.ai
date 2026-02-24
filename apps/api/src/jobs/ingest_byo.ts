import { runExaByoConnector } from '@idea/connectors/src/exa_byo';
import { runPerigonByoConnector } from '@idea/connectors/src/perigon_byo';

export const runByoConnectorIngestion = async (env: NodeJS.ProcessEnv = process.env) => {
  const [exa, perigon] = await Promise.all([runExaByoConnector(env), runPerigonByoConnector(env)]);

  return {
    connectors: {
      exa,
      perigon
    }
  };
};
