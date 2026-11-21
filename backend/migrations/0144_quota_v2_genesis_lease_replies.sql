-- Zero-authority lease replies must be committed atomically with the SQL
-- allocator, then returned byte-identically after a lost transport response.
-- This ledger does not permit VLESS, spending, restart, refund or finality.
CREATE TABLE quota_v2_genesis_lease_replies (
    node_id BIGINT NOT NULL REFERENCES quota_v2_genesis_quarantine_policies(node_id),
    user_id BIGINT NOT NULL CHECK (user_id > 0),
    stage TEXT NOT NULL CHECK (stage IN ('prepare','confirm')),
    policy_sha256 TEXT NOT NULL CHECK (policy_sha256 ~ '^[0-9a-f]{64}$'),
    signer_public_key TEXT NOT NULL CHECK (signer_public_key ~ '^[0-9a-f]{64}$'),
    signed_reply BYTEA NOT NULL CHECK (octet_length(signed_reply) BETWEEN 100 AND 8192),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (node_id,user_id,stage)
);

CREATE TRIGGER quota_v2_genesis_lease_replies_immutable
BEFORE UPDATE OR DELETE ON quota_v2_genesis_lease_replies
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE TRIGGER quota_v2_genesis_lease_replies_no_truncate
BEFORE TRUNCATE ON quota_v2_genesis_lease_replies
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

REVOKE ALL ON quota_v2_genesis_lease_replies FROM PUBLIC;
COMMENT ON TABLE quota_v2_genesis_lease_replies IS
'Exact signed zero-authority prepare/confirm replies from the same transaction as the account allocator. No positive-cap authority.';
