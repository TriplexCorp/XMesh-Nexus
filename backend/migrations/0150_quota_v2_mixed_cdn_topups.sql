-- Append-only extensions of the independently reserved CDN sub-ceiling.
-- The already signed shared/MAIN reservation may grow separately; only a
-- new, authenticated, WAL-witnessed quota revision may allocate CDN bytes.
-- This row and the exact Ed25519 cap response commit in the SAME SQL TX.
-- No expiry, crash, retry, epoch close, or partial WAL ACK refunds this hold.
CREATE TABLE quota_v2_mixed_cdn_topups (
    reservation_id UUID NOT NULL REFERENCES quota_v2_mixed_cdn_holds(reservation_id),
    revision BIGINT NOT NULL CHECK (revision > 1),
    user_id BIGINT NOT NULL CHECK (user_id > 0),
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    added_bytes BIGINT NOT NULL CHECK (added_bytes > 0 AND added_bytes <= 67108864),
    cumulative_cdn_ceiling_bytes BIGINT NOT NULL CHECK (cumulative_cdn_ceiling_bytes > 0),
    request_nonce TEXT NOT NULL CHECK (request_nonce ~ '^[a-f0-9]{64}$'),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(reservation_id,revision)
);
CREATE INDEX quota_v2_mixed_cdn_topups_user_idx
    ON quota_v2_mixed_cdn_topups(user_id,reservation_id);

CREATE TRIGGER quota_v2_mixed_cdn_topups_immutable
BEFORE UPDATE OR DELETE ON quota_v2_mixed_cdn_topups
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();
CREATE TRIGGER quota_v2_mixed_cdn_topups_no_truncate
BEFORE TRUNCATE ON quota_v2_mixed_cdn_topups
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();
REVOKE ALL ON quota_v2_mixed_cdn_topups FROM PUBLIC;
