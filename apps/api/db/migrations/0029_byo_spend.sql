CREATE TABLE IF NOT EXISTS byo_spend (
  connector TEXT NOT NULL,
  period TEXT NOT NULL,
  spent_usd NUMERIC(10,4) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (connector, period)
);
