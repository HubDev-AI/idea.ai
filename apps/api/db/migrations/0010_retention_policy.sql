-- Data retention: indexes to support efficient cleanup queries
CREATE INDEX IF NOT EXISTS signal_memory_observed_idx ON signal_memory (observed_at);
CREATE INDEX IF NOT EXISTS agent_journal_created_idx ON agent_journal (created_at);
-- agent_runs already has started_at index from 0009
