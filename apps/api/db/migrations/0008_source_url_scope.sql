-- Add source_url to signal_memory so feed can return clickable links
ALTER TABLE signal_memory ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Add estimated_scope to thesis_candidates (small/medium/large)
ALTER TABLE thesis_candidates ADD COLUMN IF NOT EXISTS estimated_scope TEXT
  CHECK (estimated_scope IS NULL OR estimated_scope IN ('small', 'medium', 'large'));
