-- XSP-v2 staging-only dual-key proof-of-possession enrollment.
-- Follows 0099. Stores public keys, owner approval and SHA-256 challenge hash;
-- does not contain private keys, tokens or a production activation flag.
CREATE TABLE node_xsp_key_enrollment_approvals (
    node_id BIGINT NOT NULL REFERENCES node_metric_keys(node_id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('node_request', 'panel_response')),
    key_epoch BIGINT NOT NULL CHECK (key_epoch > 0),
    ed25519_key_id TEXT NOT NULL CHECK (length(ed25519_key_id) BETWEEN 1 AND 64),
    mldsa65_key_id TEXT NOT NULL CHECK (length(mldsa65_key_id) BETWEEN 1 AND 64),
    ed25519_public BYTEA NOT NULL CHECK (octet_length(ed25519_public) = 32),
    mldsa65_public BYTEA NOT NULL CHECK (octet_length(mldsa65_public) = 1952),
    challenge_sha256 BYTEA NOT NULL CHECK (octet_length(challenge_sha256) = 32),
    approved_by TEXT NOT NULL CHECK (length(approved_by) BETWEEN 1 AND 128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    PRIMARY KEY (node_id, purpose),
    CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '10 minutes'),
    CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);
COMMENT ON TABLE node_xsp_key_enrollment_approvals IS
 'STAGING only: owner-approved bounded dual-key challenge. Claims must prove both private keys, consume approval and rotate epoch atomically; NEVER auto-activate strict suite.';
