import type { RawEventInput } from './common/http';

export type ByoSkipReason = 'missing_credentials' | 'budget_exhausted';

export type ConnectorStatus = 'active' | 'skipped';

export type ConnectorTelemetry = {
  connector: string;
  skipped: boolean;
  reason?: ByoSkipReason;
  budget_usd: number;
};

export type ByoConnectorResult = {
  status: ConnectorStatus;
  reason?: ByoSkipReason;
  events: RawEventInput[];
  telemetry: ConnectorTelemetry;
};

const parseBudget = (value: string | undefined, fallbackBudget: number): number => {
  const parsed = Number(value ?? fallbackBudget);
  return Number.isFinite(parsed) ? parsed : fallbackBudget;
};

export const evaluateByoGuard = ({
  connector,
  apiKey,
  budgetValue,
  fallbackBudget
}: {
  connector: string;
  apiKey?: string;
  budgetValue?: string;
  fallbackBudget: number;
}):
  | { allowed: true; budgetUsd: number }
  | { allowed: false; reason: ByoSkipReason; budgetUsd: number; telemetry: ConnectorTelemetry } => {
  const budgetUsd = parseBudget(budgetValue, fallbackBudget);

  if (!apiKey) {
    return {
      allowed: false,
      reason: 'missing_credentials',
      budgetUsd,
      telemetry: {
        connector,
        skipped: true,
        reason: 'missing_credentials',
        budget_usd: budgetUsd
      }
    };
  }

  if (budgetUsd <= 0) {
    return {
      allowed: false,
      reason: 'budget_exhausted',
      budgetUsd,
      telemetry: {
        connector,
        skipped: true,
        reason: 'budget_exhausted',
        budget_usd: budgetUsd
      }
    };
  }

  return { allowed: true, budgetUsd };
};
