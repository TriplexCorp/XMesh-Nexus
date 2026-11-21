-- Dormant staging only. No live endpoint. A dual-signed XSP/2 declaration
-- still does NOT independently attest the Linux kernel, Docker process, WAL
-- completeness, physical writer finality or actual signed policy membership.
-- An already-issued first-Xray spending grant cannot be authorized merely
-- from this row.
CREATE TABLE quota_v2_xsp2_cap_attestations (
    node_id BIGINT NOT NULL CHECK (node_id>0),
    request_challenge TEXT NOT NULL CHECK (request_challenge ~ '^[0-9a-f]{64}$'),
    user_id BIGINT NOT NULL CHECK (user_id>0),
    epoch UUID NOT NULL,
    meter_epoch UUID NOT NULL,
    reservation_id UUID NOT NULL,
    reservation_revision BIGINT NOT NULL CHECK (reservation_revision>0),
    key_epoch BIGINT NOT NULL CHECK (key_epoch>0),
    ed25519_key_id TEXT NOT NULL CHECK (length(ed25519_key_id) BETWEEN 1 AND 64),
    mldsa65_key_id TEXT NOT NULL CHECK (length(mldsa65_key_id) BETWEEN 1 AND 64),
    xsp_nonce BYTEA NOT NULL CHECK (octet_length(xsp_nonce)=16),
    assertion_sha256 TEXT NOT NULL CHECK (assertion_sha256 ~ '^[0-9a-f]{64}$'),
    signed_envelope BYTEA NOT NULL
        CHECK (octet_length(signed_envelope) BETWEEN 300 AND 8192),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    authorized_bytes BIGINT NOT NULL DEFAULT 0 CHECK (authorized_bytes=0),
    can_start BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT can_start),
    can_resume BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT can_resume),
    final_meter_verified BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT final_meter_verified),
    refundable_bytes BIGINT NOT NULL DEFAULT 0 CHECK (refundable_bytes=0),
    PRIMARY KEY (node_id,request_challenge),
    UNIQUE (node_id,key_epoch,xsp_nonce),
    FOREIGN KEY (node_id,request_challenge)
      REFERENCES quota_v2_runtime_admission_preflights (node_id,request_challenge),
    FOREIGN KEY (user_id,epoch,node_id,meter_epoch)
      REFERENCES quota_v2_reservations (user_id,epoch,node_id,meter_epoch)
);
CREATE TRIGGER quota_v2_xsp2_cap_attestation_immutable
BEFORE UPDATE OR DELETE ON quota_v2_xsp2_cap_attestations
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();
CREATE TRIGGER quota_v2_xsp2_cap_attestation_no_truncate
BEFORE TRUNCATE ON quota_v2_xsp2_cap_attestations
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();
REVOKE ALL ON quota_v2_xsp2_cap_attestations FROM PUBLIC;
COMMENT ON TABLE quota_v2_xsp2_cap_attestations IS
'NO AUTHORITY: owner-enrolled dual-signed XSP/2 staging declaration matching a zero-authority SQL preflight. Never a live Xray kernel attestation, cap install permit, or refund.';
