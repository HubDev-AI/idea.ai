export const DB_TABLES = {
  rawEvents: 'raw_events',
  normalizedSignals: 'normalized_signals',
  publishedSignals: 'published_signals',
  connectorState: 'connector_state'
} as const;

export type DbTableName = (typeof DB_TABLES)[keyof typeof DB_TABLES];
