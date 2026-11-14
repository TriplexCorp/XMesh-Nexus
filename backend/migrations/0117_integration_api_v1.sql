-- Service-to-service Integration API v1.
-- No administrator cookie or payment/billing credentials are stored here.
CREATE TABLE integration_clients (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
       CHECK (char_length(name) BETWEEN 3 AND 64),
    disabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE integration_tokens (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id BIGINT NOT NULL REFERENCES integration_clients(id) ON DELETE RESTRICT,
    label TEXT NOT NULL CHECK (char_length(label) BETWEEN 3 AND 128),
    token_hash TEXT NOT NULL UNIQUE
       CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    scopes TEXT[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 24),
    -- NULL is permitted only when the owner explicitly approves access to all users.
    allowed_user_ids BIGINT[],
    created_by BIGINT NOT NULL REFERENCES panel_auth_users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    CONSTRAINT integration_token_allowed_users
       CHECK (allowed_user_ids IS NULL OR cardinality(allowed_user_ids) BETWEEN 1 AND 10000),
    CONSTRAINT integration_token_expiry
       CHECK (expires_at > created_at)
);
CREATE INDEX integration_tokens_client_idx ON integration_tokens(client_id);
CREATE INDEX integration_tokens_expiry_idx ON integration_tokens(expires_at)
  WHERE revoked_at IS NULL;

-- Idempotency is keyed to STABLE integration client, not rotating token ID.
-- Keep completed operations indefinitely until an explicit operator migration
-- defines a ledger archive. This avoids re-crediting old orders on delayed retries.
CREATE TABLE integration_operations (
    client_id BIGINT NOT NULL REFERENCES integration_clients(id) ON DELETE RESTRICT,
    idempotency_key UUID NOT NULL,
    action TEXT NOT NULL,
    request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    PRIMARY KEY(client_id,idempotency_key),
    CONSTRAINT integration_operation_completed CHECK (
       (completed_at IS NULL AND response IS NULL)
       OR (completed_at IS NOT NULL AND response IS NOT NULL)
    )
);
CREATE INDEX integration_operations_created_idx ON integration_operations(created_at);
