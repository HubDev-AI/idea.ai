ALTER TABLE scoring_weight_history ADD COLUMN IF NOT EXISTS profile_id TEXT NOT NULL DEFAULT 'consumer';
CREATE INDEX IF NOT EXISTS idx_scoring_weight_history_profile ON scoring_weight_history (profile_id, computed_at DESC);
