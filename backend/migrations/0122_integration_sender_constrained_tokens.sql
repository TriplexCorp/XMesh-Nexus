-- Service credentials can be bound to a client-held Ed25519 signing key.
-- Keep existing tokens compatible until the owner revokes and re-issues them.
ALTER TABLE integration_tokens
  ADD COLUMN proof_public_key BYTEA,
  ADD COLUMN max_grant_days INTEGER,
  ADD COLUMN max_creates_per_day INTEGER,
  ADD CONSTRAINT integration_token_proof_key_len
    CHECK (proof_public_key IS NULL OR octet_length(proof_public_key) = 32),
  ADD CONSTRAINT integration_token_max_grant_days
    CHECK (max_grant_days IS NULL OR max_grant_days BETWEEN 1 AND 3650),
  ADD CONSTRAINT integration_token_max_creates_per_day
    CHECK (max_creates_per_day IS NULL OR max_creates_per_day BETWEEN 1 AND 1000);

-- Daily issuance limits count only committed, unique creation operations.
CREATE INDEX IF NOT EXISTS integration_ops_creates_daily_idx
 ON integration_operations (client_id, completed_at)
 WHERE action = 'user.create' AND completed_at IS NOT NULL;
