-- Upgrade embedding dimension from 32 (local hash) to 768 (nomic-embed-text via Ollama)
-- Only delete+rebuild if column is still 32-dim. Safe for re-runs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'signal_embeddings' AND column_name = 'embedding'
      AND udt_name = 'vector'
      AND character_maximum_length = 32
  ) THEN
    DELETE FROM signal_embeddings;
    DROP INDEX IF EXISTS signal_embeddings_idx;
    ALTER TABLE signal_embeddings ALTER COLUMN embedding TYPE vector(768);
    CREATE INDEX signal_embeddings_idx ON signal_embeddings USING hnsw (embedding vector_cosine_ops);
  ELSE
    -- Already 768-dim, just ensure index exists
    CREATE INDEX IF NOT EXISTS signal_embeddings_idx ON signal_embeddings USING hnsw (embedding vector_cosine_ops);
  END IF;
END $$;
