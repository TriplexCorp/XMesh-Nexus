-- XSP-v2 staged cutover permit/ACK persistence scaffold ONLY.
-- NOT a key-epoch advancement mechanism, not a permit issuer, and no live API.
-- Permit signing and approval must happen outside this migration under separately
-- pinned panel_response signer control. Fail closed until that integration exists.
CREATE TABLE node_xsp_cutover_permit_ledger (
    node_id BIGINT NOT NULL REFERENCES node_metric_keys(node_id) ON DELETE CASCADE,
    request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
    from_epoch BIGINT NOT NULL CHECK (from_epoch > 0),
    to_epoch BIGINT NOT NULL CHECK (to_epoch = from_epoch + 1),
    candidate_sha256 BYTEA NOT NULL CHECK (octet_length(candidate_sha256) = 32),
    permit_nonce BYTEA NOT NULL CHECK (octet_length(permit_nonce) = 16),
    permit_input_sha256 BYTEA NOT NULL CHECK (octet_length(permit_input_sha256) = 32),
    -- Exact authenticated envelope: never reconstruct a permit from JSON fields
    -- during replay verification or after a crash.
    signed_permit BYTEA NOT NULL CHECK (octet_length(signed_permit) BETWEEN 1 AND 16384),
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    issued_by TEXT NOT NULL CHECK (length(issued_by) BETWEEN 1 AND 128),
    -- No SQL default advances trust. Only an explicitly verified application
    -- transaction may move issued -> ack_verified -> receipt_sent.
    state TEXT NOT NULL DEFAULT 'issued'
        CHECK (state IN ('issued','ack_verified','receipt_sent','aborted')),
    applied_ack_sha256 BYTEA CHECK (
        applied_ack_sha256 IS NULL OR octet_length(applied_ack_sha256) = 32
    ),
    signed_applied_ack BYTEA CHECK (
        signed_applied_ack IS NULL OR octet_length(signed_applied_ack) BETWEEN 1 AND 16384
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ack_verified_at TIMESTAMPTZ,
    PRIMARY KEY (node_id, request_id),
    UNIQUE (node_id, permit_nonce),
    UNIQUE (node_id, permit_input_sha256),
    CHECK (expires_at > issued_at AND expires_at <= issued_at + INTERVAL '60 seconds'),
    CHECK (
        (state = 'issued' AND applied_ack_sha256 IS NULL AND signed_applied_ack IS NULL AND ack_verified_at IS NULL)
        OR (state = 'aborted' AND ack_verified_at IS NULL)
        OR (state IN ('ack_verified','receipt_sent')
            AND applied_ack_sha256 IS NOT NULL
            AND signed_applied_ack IS NOT NULL
            AND ack_verified_at IS NOT NULL)
    )
);
-- Only one in-flight, unacknowledged request for a node. A new proposal is
-- never silently allowed to override another issued permit.
CREATE UNIQUE INDEX node_xsp_cutover_one_issued_per_node
    ON node_xsp_cutover_permit_ledger (node_id) WHERE state = 'issued';

COMMENT ON TABLE node_xsp_cutover_permit_ledger IS
    'XSP-v2 STAGING ONLY: durable exact permit bytes, one-time nonce/request and eventual authenticated ACK; no trigger, no network API, no automatic epoch switching or key revocation. Requires reviewed transactional writer and verifier before use.';
