-- Bound the work caused by password spray across many distinct usernames.
-- This is a global pressure valve, complementary to account-specific limits.
CREATE TABLE IF NOT EXISTS auth_global_limits (
  minute_start TIMESTAMPTZ PRIMARY KEY,
  attempts BIGINT NOT NULL CHECK (attempts >= 0)
);
CREATE INDEX IF NOT EXISTS auth_login_limits_window_idx
  ON auth_login_limits(window_started_at);
