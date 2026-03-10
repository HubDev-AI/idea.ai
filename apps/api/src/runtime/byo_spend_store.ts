import type { Pool } from 'pg';

export type ByoSpendStore = {
  record(connector: string, amountUsd: number): Promise<void>;
  getSpent(connector: string): Promise<number>;
};

const currentPeriod = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

export const createByoSpendStore = (deps: { pool: Pool }): ByoSpendStore => ({
  async record(connector, amountUsd) {
    const period = currentPeriod();
    await deps.pool.query(
      `INSERT INTO byo_spend (connector, period, spent_usd, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (connector, period) DO UPDATE SET
         spent_usd = byo_spend.spent_usd + EXCLUDED.spent_usd,
         updated_at = NOW()`,
      [connector, period, amountUsd]
    );
  },

  async getSpent(connector) {
    const period = currentPeriod();
    const { rows } = await deps.pool.query<{ spent_usd: string }>(
      `SELECT spent_usd FROM byo_spend WHERE connector = $1 AND period = $2`,
      [connector, period]
    );
    return rows[0] ? Number(rows[0].spent_usd) : 0;
  },
});
