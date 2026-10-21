-- Encrypted TOTP secrets and one-time recovery credentials. No existing account
-- becomes MFA-enabled until its own setup is confirmed.
CREATE TABLE IF NOT EXISTS panel_totp (
  admin_id BIGINT PRIMARY KEY REFERENCES panel_auth_users(id) ON DELETE CASCADE,
  secret_encrypted TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  pending_expires_at TIMESTAMPTZ,
  setup_attempts INTEGER NOT NULL DEFAULT 0,
  last_used_step BIGINT NOT NULL DEFAULT -1,
  enabled_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS panel_totp_recovery (
  admin_id BIGINT NOT NULL REFERENCES panel_auth_users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  PRIMARY KEY(admin_id, code_hash)
);
CREATE TABLE IF NOT EXISTS panel_mfa_challenges (
  token_hash TEXT PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES panel_auth_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS panel_mfa_challenges_admin ON panel_mfa_challenges(admin_id);
