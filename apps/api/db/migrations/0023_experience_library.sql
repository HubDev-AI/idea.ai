-- 0023_experience_library.sql
-- Experience library: stores validated thesis generation trajectories for few-shot learning

CREATE TABLE IF NOT EXISTS experience_library (
  id SERIAL PRIMARY KEY,
  thesis_key TEXT NOT NULL,
  signal_summary TEXT NOT NULL,
  reasoning_trajectory TEXT NOT NULL,
  thesis_output TEXT NOT NULL,
  outcome_validated BOOLEAN DEFAULT FALSE,
  validation_details JSONB,
  confidence_at_creation REAL,
  confidence_at_validation REAL,
  embedding VECTOR(768),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  validated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_experience_library_thesis ON experience_library(thesis_key);
CREATE INDEX IF NOT EXISTS idx_experience_library_validated ON experience_library(outcome_validated);
CREATE INDEX IF NOT EXISTS idx_experience_library_embed
  ON experience_library USING hnsw (embedding vector_cosine_ops);
