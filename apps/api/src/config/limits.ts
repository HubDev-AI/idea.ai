export const LIMITS = {
  connectorTimeoutMs: 15_000,
  connectorRetries: 2,
  hourlyBatchLimit: 50,
  dailyBatchLimit: 100,
  defaultRawRetentionDays: 30
} as const;
