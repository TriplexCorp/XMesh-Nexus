-- XSP-v2 staged rotation proposal ONLY. Neither a cutover nor strict-mode
-- activation. All keys are PUBLIC; proving new key possession cannot revoke
-- the previously accepted verification keys or advance any suite/epoch floor.
CREATE TABLE node_xsp_rotation_preparations (
    node_id BIGINT NOT NULL REFERENCES node_metric_keys(node_id) ON DELETE CASCADE,
    purpose TEXT NOT NULL DEFAULT 'node_request' CHECK (purpose='node_request'),
    from_epoch BIGINT NOT NULL CHECK (from_epoch > 0),
    to_epoch BIGINT NOT NULL CHECK (to_epoch = from_epoch + 1),
    ed25519_key_id TEXT NOT NULL CHECK (length(ed25519_key_id) BETWEEN 1 AND 64),
    mldsa65_key_id TEXT NOT NULL CHECK (length(mldsa65_key_id) BETWEEN 1 AND 64),
    ed25519_public BYTEA NOT NULL CHECK (octet_length(ed25519_public)=32),
    mldsa65_public BYTEA NOT NULL CHECK (octet_length(mldsa65_public)=1952),
    challenge_sha256 BYTEA NOT NULL CHECK (octet_length(challenge_sha256)=32),
    approved_by TEXT NOT NULL CHECK (length(approved_by) BETWEEN 1 AND 128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    proved_at TIMESTAMPTZ,
    PRIMARY KEY(node_id,purpose),
    CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '10 minutes'),
    CHECK (proved_at IS NULL OR (proved_at >= created_at AND proved_at <= expires_at))
);
COMMENT ON TABLE node_xsp_rotation_preparations IS
    'Staging-only pending public key proposal and dual PoP; never enables new epoch, revokes old keys, or authorizes Node activation. Signed Node cutover ACK is not implemented.';
