export type SignalRecord = {
  idea: string;
  score: number;
  top_source: string;
  snippet: string;
  next_action: 'validate_demand' | 'validate_pricing' | 'validate_channel';
  updated_at: string;
};

export type ConnectorRecord = {
  name: string;
  status: 'active' | 'disabled' | 'error';
  last_run: string | null;
};

export const fetchSignals = async (): Promise<SignalRecord[]> => {
  const response = await fetch('/v1/signals');
  if (!response.ok) {
    throw new Error('Failed to load signals');
  }

  return response.json() as Promise<SignalRecord[]>;
};

export const fetchConnectors = async (): Promise<ConnectorRecord[]> => {
  const response = await fetch('/v1/connectors');
  if (!response.ok) {
    throw new Error('Failed to load connectors');
  }

  return response.json() as Promise<ConnectorRecord[]>;
};
