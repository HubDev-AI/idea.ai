ALTER TABLE thesis_candidates
  ADD COLUMN IF NOT EXISTS label TEXT DEFAULT NULL
  CHECK (label IS NULL OR label IN ('favourite', 'later', 'dismissed'));

CREATE INDEX IF NOT EXISTS idx_thesis_candidates_label
  ON thesis_candidates (label) WHERE label IS NOT NULL;
