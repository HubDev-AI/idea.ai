-- Rename avg_pain → avg_demand in trend_windows to match signal_memory rename
ALTER TABLE trend_windows RENAME COLUMN avg_pain TO avg_demand;
