ALTER TABLE signal_memory RENAME TO scored_signals;

-- Update foreign-key-like references in trend_windows queries (no FK exists, just SQL references)
-- Update the retention cleanup orphan check (signal_embeddings references signal_id)
-- No FK changes needed — signal_embeddings.signal_id has no declared FK to signal_memory
