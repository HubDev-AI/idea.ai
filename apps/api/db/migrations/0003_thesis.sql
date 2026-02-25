CREATE TABLE IF NOT EXISTS synthesis_runs (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  source_signal_count INTEGER NOT NULL,
  candidate_count INTEGER NOT NULL,
  promoted_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS thesis_candidates (
  id BIGSERIAL PRIMARY KEY,
  canonical_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'watching', 'promoted', 'stale', 'rejected')),
  confidence NUMERIC(5,2) NOT NULL,
  problem_statement TEXT NOT NULL,
  target_buyer TEXT NOT NULL,
  proposed_solution TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS thesis_candidates_status_idx
  ON thesis_candidates (status, confidence DESC);

CREATE TABLE IF NOT EXISTS thesis_evidence (
  id BIGSERIAL PRIMARY KEY,
  thesis_id BIGINT NOT NULL REFERENCES thesis_candidates(id) ON DELETE CASCADE,
  signal_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('supporting', 'adjacent', 'contradicting')),
  weight NUMERIC(5,2) NOT NULL,
  snippet TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (thesis_id, signal_id)
);

CREATE INDEX IF NOT EXISTS thesis_evidence_thesis_idx
  ON thesis_evidence (thesis_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS thesis_snapshots (
  id BIGSERIAL PRIMARY KEY,
  thesis_id BIGINT NOT NULL REFERENCES thesis_candidates(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  score_total NUMERIC(5,2) NOT NULL,
  evidence_count INTEGER NOT NULL,
  avg_pain NUMERIC(5,2) NOT NULL,
  avg_timing NUMERIC(5,2) NOT NULL,
  avg_buildability NUMERIC(5,2) NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (thesis_id, run_id)
);

CREATE INDEX IF NOT EXISTS thesis_snapshots_thesis_idx
  ON thesis_snapshots (thesis_id, captured_at DESC);

