-- Move cadence refresh timestamps from JSON file to database
CREATE TABLE IF NOT EXISTS refresh_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_hourly_run_at TIMESTAMPTZ,
  last_daily_run_at TIMESTAMPTZ,
  refreshed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed single row
INSERT INTO refresh_state (id, last_hourly_run_at, last_daily_run_at, refreshed_at)
VALUES (1, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
