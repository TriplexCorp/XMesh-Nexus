-- Durable pre-delivery byte intents are a conservative charge. Keep them
-- separately from counters of observed traffic and terminal revocation burns.
CREATE TABLE quota_v2_wal_charges (
    reservation_id UUID NOT NULL REFERENCES quota_v2_reservations(reservation_id),
    filename TEXT NOT NULL CHECK (filename ~ '^meter-[0-9a-f]{64}\.jsonl$'),
    first_sequence BIGINT NOT NULL CHECK (first_sequence>0),
    last_sequence BIGINT NOT NULL CHECK (last_sequence>=first_sequence),
    last_digest TEXT NOT NULL CHECK (last_digest ~ '^[0-9a-f]{64}$'),
    stream_bytes BIGINT NOT NULL CHECK (stream_bytes>0),
    is_cdn BOOLEAN NOT NULL,
    journal BYTEA NOT NULL CHECK (octet_length(journal) BETWEEN 1 AND 65536),
    signed_receipt BYTEA NOT NULL CHECK (octet_length(signed_receipt) BETWEEN 100 AND 4096),
    PRIMARY KEY(reservation_id,filename,first_sequence)
);

CREATE TRIGGER quota_v2_wal_charges_immutable
BEFORE UPDATE OR DELETE ON quota_v2_wal_charges
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE TRIGGER quota_v2_wal_charges_no_truncate
BEFORE TRUNCATE ON quota_v2_wal_charges
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

REVOKE ALL ON quota_v2_wal_charges FROM PUBLIC;

-- The terminal operator burn charges the remaining reserve after any
-- authenticated WAL charges, without counting the WAL intents a second time.
CREATE OR REPLACE FUNCTION quota_v2_burn_revoked(
    p_user BIGINT, p_epoch UUID, p_node BIGINT, p_meter UUID,
    p_id UUID, p_request UUID
) RETURNS quota_v2_reservations LANGUAGE plpgsql AS $$
DECLARE
    account quota_v2_accounts;
    lease quota_v2_reservations;
    amount BIGINT;
BEGIN
    SELECT * INTO STRICT account FROM quota_v2_accounts
      WHERE user_id=p_user AND epoch=p_epoch FOR UPDATE;
    SELECT * INTO STRICT lease FROM quota_v2_reservations
      WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node AND meter_epoch=p_meter
      FOR UPDATE;
    IF lease.reservation_id != p_id THEN
        RAISE EXCEPTION 'burn reservation mismatch' USING ERRCODE='22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM quota_v2_revocation_requests r
        WHERE r.user_id=p_user AND r.epoch=p_epoch AND r.node_id=p_node
          AND r.meter_epoch=p_meter AND r.reservation_id=p_id
          AND r.request_id=p_request
    ) THEN
        RAISE EXCEPTION 'signed revocation intent required before burn'
            USING ERRCODE='22023';
    END IF;
    -- An exact retry is idempotent, including after the account closes.
    IF lease.conservative_burned_at IS NOT NULL THEN
        RETURN lease;
    END IF;
    IF account.closed THEN
        RAISE EXCEPTION 'closed epoch cannot be burned' USING ERRCODE='22023';
    END IF;
    amount := lease.ceiling_bytes-GREATEST(lease.acknowledged_bytes,
                                          lease.conservative_burn_floor_bytes);
    IF amount < 0 THEN
        RAISE EXCEPTION 'invalid reservation accounting' USING ERRCODE='22023';
    END IF;
    UPDATE quota_v2_accounts
      SET settled_bytes=settled_bytes+amount
      WHERE user_id=p_user AND epoch=p_epoch;
    UPDATE quota_v2_reservations
      SET conservative_burn_floor_bytes=ceiling_bytes,
          conservative_burned_bytes=amount,
          conservative_burned_at=NOW()
      WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node
        AND meter_epoch=p_meter AND reservation_id=p_id
      RETURNING * INTO lease;
    RETURN lease;
END;
$$;
