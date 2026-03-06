-- Add profile_id to thesis_candidates (default 'consumer' for existing rows)
ALTER TABLE thesis_candidates
  ADD COLUMN IF NOT EXISTS profile_id TEXT NOT NULL DEFAULT 'consumer';

-- Add profile_id to thesis_snapshots
ALTER TABLE thesis_snapshots
  ADD COLUMN IF NOT EXISTS profile_id TEXT NOT NULL DEFAULT 'consumer';

-- Index for filtering by profile
CREATE INDEX IF NOT EXISTS idx_thesis_candidates_profile
  ON thesis_candidates (profile_id);
