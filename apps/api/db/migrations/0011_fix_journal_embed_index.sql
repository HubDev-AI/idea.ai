-- Fix: HNSW index should be partial, excluding NULL embeddings
DROP INDEX IF EXISTS agent_journal_embed_idx;
CREATE INDEX agent_journal_embed_idx ON agent_journal
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
