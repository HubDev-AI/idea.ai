CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS signal_memory (
  id BIGSERIAL PRIMARY KEY,
  signal_id TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  source TEXT NOT NULL,
  canonical_text TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  pain NUMERIC(5,2) NOT NULL,
  timing NUMERIC(5,2) NOT NULL,
  buildability NUMERIC(5,2) NOT NULL,
  blended NUMERIC(5,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signal_embeddings (
  signal_id TEXT PRIMARY KEY,
  embedding vector(32) NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_signal_embeddings_signal
    FOREIGN KEY (signal_id)
    REFERENCES signal_memory(signal_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS signal_embeddings_idx
  ON signal_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE TABLE IF NOT EXISTS trend_windows (
  id BIGSERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  source TEXT NOT NULL,
  "window" TEXT NOT NULL CHECK ("window" IN ('7d', '30d', '90d')),
  count_signals INTEGER NOT NULL,
  avg_pain NUMERIC(5,2) NOT NULL,
  avg_timing NUMERIC(5,2) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (topic, source, "window")
);
