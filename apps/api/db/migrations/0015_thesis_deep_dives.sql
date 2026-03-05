CREATE TABLE IF NOT EXISTS thesis_deep_dives (
  id BIGSERIAL PRIMARY KEY,
  canonical_key TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  how_it_works TEXT NOT NULL,
  growth_strategy TEXT NOT NULL,
  build_suggestions TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS thesis_deep_dives_key_idx
  ON thesis_deep_dives (canonical_key);
