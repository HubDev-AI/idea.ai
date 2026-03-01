-- Rename pain → demand across signal_memory
ALTER TABLE signal_memory RENAME COLUMN pain TO demand;

-- Add virality column (nullable for backward compat with existing signals)
ALTER TABLE signal_memory ADD COLUMN virality NUMERIC(5,2);
