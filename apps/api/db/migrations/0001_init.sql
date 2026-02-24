CREATE TABLE IF NOT EXISTS raw_events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  source_timestamp TIMESTAMPTZ NOT NULL,
  text_body TEXT NOT NULL,
  url TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, source_item_id)
);

CREATE TABLE IF NOT EXISTS normalized_signals (
  id BIGSERIAL PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  idea TEXT NOT NULL,
  top_source TEXT NOT NULL,
  snippet TEXT NOT NULL,
  score_pain NUMERIC(5,2) NOT NULL,
  score_timing NUMERIC(5,2) NOT NULL,
  score_buildability NUMERIC(5,2) NOT NULL,
  score_blended NUMERIC(5,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS published_signals (
  id BIGSERIAL PRIMARY KEY,
  normalized_signal_id BIGINT NOT NULL REFERENCES normalized_signals(id) ON DELETE CASCADE,
  idea TEXT NOT NULL,
  score NUMERIC(5,2) NOT NULL,
  top_source TEXT NOT NULL,
  snippet TEXT NOT NULL,
  next_action TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS connector_state (
  connector_name TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_run_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
