CREATE TABLE IF NOT EXISTS agent_journal (
  id            SERIAL PRIMARY KEY,
  run_id        TEXT NOT NULL,
  entry_type    TEXT NOT NULL CHECK (entry_type IN (
    'trend_shift', 'emerging_pattern', 'thesis_evolution', 'market_signal', 'run_summary'
  )),
  topic         TEXT NOT NULL,
  insight       TEXT NOT NULL,
  narrative     TEXT,
  confidence    NUMERIC(5,2) DEFAULT 50,
  thesis_keys   TEXT[] DEFAULT '{}',
  signal_ids    TEXT[] DEFAULT '{}',
  embedding     vector(768),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX agent_journal_type_idx ON agent_journal (entry_type);
CREATE INDEX agent_journal_created_idx ON agent_journal (created_at DESC);
CREATE INDEX agent_journal_embed_idx ON agent_journal USING hnsw (embedding vector_cosine_ops);
