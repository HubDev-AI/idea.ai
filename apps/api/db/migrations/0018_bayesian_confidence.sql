-- 0018_bayesian_confidence.sql
-- Add Bayesian confidence tracking columns to thesis_candidates

ALTER TABLE thesis_candidates ADD COLUMN IF NOT EXISTS prior_confidence REAL DEFAULT 20;
ALTER TABLE thesis_candidates ADD COLUMN IF NOT EXISTS posterior_confidence REAL DEFAULT 20;
ALTER TABLE thesis_candidates ADD COLUMN IF NOT EXISTS evidence_count_bayes INTEGER DEFAULT 0;
ALTER TABLE thesis_candidates ADD COLUMN IF NOT EXISTS confirming_signals INTEGER DEFAULT 0;
ALTER TABLE thesis_candidates ADD COLUMN IF NOT EXISTS contradicting_signals INTEGER DEFAULT 0;
ALTER TABLE thesis_candidates ADD COLUMN IF NOT EXISTS confidence_last_updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill existing theses: set posterior_confidence = current confidence
UPDATE thesis_candidates
SET posterior_confidence = confidence,
    prior_confidence = GREATEST(confidence * 0.8, 20);
