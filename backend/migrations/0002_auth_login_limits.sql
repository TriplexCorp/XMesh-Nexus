CREATE TABLE IF NOT EXISTS auth_login_limits (
    username_key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS auth_login_limits_locked_until_idx
    ON auth_login_limits (locked_until)
    WHERE locked_until IS NOT NULL;
