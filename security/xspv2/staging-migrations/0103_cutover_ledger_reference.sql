-- STAGING REFERENCE ONLY. Not in backend/migrations:
-- deploying this file manually requires reviewed operator approval.
-- Does not change node_metric_keys, active epochs or old-key trust.
BEGIN;
CREATE TABLE IF NOT EXISTS xsp_v2_cutover_permit_ledger (
    node_id BIGINT NOT NULL REFERENCES node_metric_keys(node_id) ON DELETE RESTRICT,
    purpose TEXT NOT NULL DEFAULT 'node_request' CHECK (purpose = 'node_request'),
    request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 64),
    from_epoch BIGINT NOT NULL CHECK (from_epoch > 0),
    to_epoch BIGINT NOT NULL CHECK (to_epoch = from_epoch + 1),
    candidate_sha256 BYTEA NOT NULL CHECK (octet_length(candidate_sha256) = 32),
    permit_nonce BYTEA NOT NULL CHECK (octet_length(permit_nonce) = 16),
    permit_input_sha256 BYTEA NOT NULL CHECK (octet_length(permit_input_sha256) = 32),
    signed_permit BYTEA NOT NULL CHECK (octet_length(signed_permit) BETWEEN 1 AND 16384),
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    approved_by TEXT NOT NULL CHECK (length(approved_by) BETWEEN 1 AND 128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    status TEXT NOT NULL DEFAULT 'issued'
        CHECK (status IN ('issued', 'ack_verified', 'commit_receipt_pending', 'receipt_seen', 'expired')),
    ack_nonce BYTEA CHECK (ack_nonce IS NULL OR octet_length(ack_nonce)=16),
    ack_input_sha256 BYTEA CHECK (ack_input_sha256 IS NULL OR octet_length(ack_input_sha256)=32),
    signed_ack BYTEA CHECK (signed_ack IS NULL OR octet_length(signed_ack) BETWEEN 1 AND 16384),
    ack_verified_at TIMESTAMPTZ,
    receipt_input_sha256 BYTEA CHECK (receipt_input_sha256 IS NULL OR octet_length(receipt_input_sha256)=32),
    PRIMARY KEY (node_id, purpose, request_id),
    UNIQUE (node_id, purpose, to_epoch),
    UNIQUE (node_id, purpose, permit_nonce),
    CHECK (expires_at > issued_at AND expires_at <= issued_at + INTERVAL '60 seconds'),
    CHECK ((ack_nonce IS NULL AND ack_input_sha256 IS NULL AND signed_ack IS NULL AND ack_verified_at IS NULL)
           OR (ack_nonce IS NOT NULL AND ack_input_sha256 IS NOT NULL AND signed_ack IS NOT NULL AND ack_verified_at IS NOT NULL)),
    CHECK (status = 'issued' OR status = 'expired'
           OR (ack_input_sha256 IS NOT NULL AND signed_ack IS NOT NULL))
);
-- Prevent ANY second live issued cutover per node+purpose, even for another epoch.
CREATE UNIQUE INDEX IF NOT EXISTS xsp_v2_cutover_at_most_one_pending
  ON xsp_v2_cutover_permit_ledger (node_id, purpose)
  WHERE status IN ('issued','ack_verified','commit_receipt_pending');
COMMENT ON TABLE xsp_v2_cutover_permit_ledger IS
  'XSP-v2 signed permit/ACK design: not a production API or an enabled rotation. Operator-reviewed staging migration only.';
COMMIT;
