-- 0025_debates_composite_index.sql
CREATE INDEX IF NOT EXISTS idx_thesis_debates_key_created
  ON thesis_debates(thesis_key, created_at DESC);
