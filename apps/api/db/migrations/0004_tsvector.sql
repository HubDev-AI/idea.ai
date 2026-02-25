ALTER TABLE signal_memory ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', canonical_text)) STORED;

CREATE INDEX IF NOT EXISTS signal_memory_tsv_idx ON signal_memory USING GIN (tsv);
