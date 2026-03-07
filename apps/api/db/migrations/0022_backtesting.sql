-- 0022_backtesting.sql
-- Prediction snapshots and scoring weight history for backtesting engine

CREATE TABLE IF NOT EXISTS thesis_predictions (
  id SERIAL PRIMARY KEY,
  thesis_key TEXT NOT NULL,
  predicted_at TIMESTAMPTZ NOT NULL,
  confidence_at_prediction REAL NOT NULL,
  demand_score REAL,
  timing_score REAL,
  buildability_score REAL,
  virality_score REAL,
  velocity REAL,
  source_categories INTEGER,
  outcome_checked_at TIMESTAMPTZ,
  outcome_validated BOOLEAN,
  validation_signals JSONB,
  UNIQUE(thesis_key, predicted_at)
);

CREATE INDEX IF NOT EXISTS idx_thesis_predictions_key ON thesis_predictions(thesis_key);
CREATE INDEX IF NOT EXISTS idx_thesis_predictions_unchecked
  ON thesis_predictions(predicted_at) WHERE outcome_checked_at IS NULL;

CREATE TABLE IF NOT EXISTS scoring_weight_history (
  id SERIAL PRIMARY KEY,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  demand_weight REAL NOT NULL,
  timing_weight REAL NOT NULL,
  buildability_weight REAL NOT NULL,
  virality_weight REAL NOT NULL,
  velocity_weight REAL NOT NULL,
  precision_score REAL,
  recall_score REAL,
  sample_size INTEGER
);
