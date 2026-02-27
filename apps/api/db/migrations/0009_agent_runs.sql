CREATE TABLE IF NOT EXISTS agent_runs (
  id            SERIAL PRIMARY KEY,
  run_id        TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  duration_ms   INT,
  clusters_analyzed    INT DEFAULT 0,
  deep_dives_performed INT DEFAULT 0,
  theses_updated       INT DEFAULT 0,
  new_candidates       INT DEFAULT 0,
  journal_entries_written INT DEFAULT 0,
  investigate_next     TEXT,
  error_message        TEXT,
  error_stack          TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX agent_runs_started_idx ON agent_runs (started_at DESC);
