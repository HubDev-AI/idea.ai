-- Add velocity and corroboration score columns to thesis_candidates
ALTER TABLE thesis_candidates ADD COLUMN IF NOT EXISTS velocity REAL;
ALTER TABLE thesis_candidates ADD COLUMN IF NOT EXISTS corroboration_score REAL;
