-- Upgrade embedding dimension from 32 (local hash) to 768 (nomic-embed-text via Ollama)
-- Existing 32-dim embeddings are incompatible and must be removed.

DELETE FROM signal_embeddings;

DROP INDEX IF EXISTS signal_embeddings_idx;

ALTER TABLE signal_embeddings
  ALTER COLUMN embedding TYPE vector(768);

-- Recreate the cosine-distance index.
-- ivfflat requires >= 100 rows to build with lists=100; use HNSW instead for small tables.
CREATE INDEX signal_embeddings_idx
  ON signal_embeddings
  USING hnsw (embedding vector_cosine_ops);
