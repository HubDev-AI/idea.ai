-- Index on signal_memory.source for efficient COUNT GROUP BY source queries
CREATE INDEX IF NOT EXISTS signal_memory_source_idx ON signal_memory (source);
