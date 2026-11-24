-- Zero-authority transition receipt, NOT a new SQL spending reservation.
-- One immutable signed preparation per historical predecessor. A future
-- implementation must separately prove fresh meter/WAL isolation and fund
-- a new reservation before any Xray cap can spend again.
CREATE TABLE quota_v2_calendar_successor_preparations (
    predecessor_id UUID PRIMARY KEY REFERENCES quota_v2_reservations(reservation_id),
    node_id BIGINT NOT NULL CHECK(node_id > 0),
    user_id BIGINT NOT NULL CHECK(user_id > 0),
    request_challenge TEXT NOT NULL CHECK(request_challenge ~ '^[0-9a-f]{64}$'),
    signer_public_key TEXT NOT NULL CHECK(signer_public_key ~ '^[0-9a-f]{64}$'),
    account_epoch UUID NOT NULL,
    predecessor_runtime_id TEXT NOT NULL CHECK(predecessor_runtime_id ~ '^[0-9a-f]{64}$'),
    policy_sha256 TEXT NOT NULL CHECK(policy_sha256 ~ '^[0-9a-f]{64}$'),
    candidate_meter_epoch UUID NOT NULL UNIQUE,
    candidate_reservation_id UUID NOT NULL UNIQUE,
    issued_at_ms BIGINT NOT NULL CHECK(issued_at_ms > 0),
    valid_until_ms BIGINT NOT NULL CHECK(valid_until_ms > issued_at_ms
                                       AND valid_until_ms <= issued_at_ms + 120000),
    signed_envelope BYTEA NOT NULL CHECK(octet_length(signed_envelope) BETWEEN 200 AND 8192),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(node_id,user_id,request_challenge),
    CHECK(candidate_meter_epoch <> predecessor_id
      AND candidate_reservation_id <> predecessor_id
      AND candidate_meter_epoch <> candidate_reservation_id)
);

CREATE TRIGGER quota_v2_calendar_successor_immutable
BEFORE UPDATE OR DELETE ON quota_v2_calendar_successor_preparations
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE TRIGGER quota_v2_calendar_successor_no_truncate
BEFORE TRUNCATE ON quota_v2_calendar_successor_preparations
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

REVOKE ALL ON quota_v2_calendar_successor_preparations FROM PUBLIC;
COMMENT ON TABLE quota_v2_calendar_successor_preparations IS
'Immutable, signed, ZERO-SPEND planning receipt only. This table cannot create a quota_v2_reservations row, admit VLESS or refund WAL.';
