-- 0021_thesis_debates.sql
-- Store adversarial debate transcripts for thesis evaluation transparency

CREATE TABLE IF NOT EXISTS thesis_debates (
  id SERIAL PRIMARY KEY,
  thesis_key TEXT NOT NULL,
  run_id TEXT NOT NULL,
  bull_provider TEXT NOT NULL,
  bear_provider TEXT NOT NULL,
  bull_case TEXT NOT NULL,
  bear_case TEXT NOT NULL,
  moderator_verdict JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thesis_debates_key ON thesis_debates(thesis_key);
CREATE INDEX IF NOT EXISTS idx_thesis_debates_run ON thesis_debates(run_id);
