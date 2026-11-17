-- Operator-only recovery path. Does NOT refund unused bytes and DOES NOT
-- pretend an offline Node acknowledged consumption. A genuine receipt remains
-- independently tracked as acknowledged_bytes and is chargeable above burn floor.
ALTER TABLE quota_v2_reservations
  ADD COLUMN conservative_burn_floor_bytes BIGINT NOT NULL DEFAULT 0
    CHECK (conservative_burn_floor_bytes>=0 AND conservative_burn_floor_bytes<=ceiling_bytes),
  ADD COLUMN conservative_burned_bytes BIGINT NOT NULL DEFAULT 0
    CHECK (conservative_burned_bytes>=0),
  ADD COLUMN conservative_burned_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION quota_v2_reserve(
    p_user BIGINT, p_epoch UUID, p_node BIGINT, p_meter UUID,
    p_id UUID, p_target BIGINT, p_ack BIGINT, p_until TIMESTAMPTZ
) RETURNS quota_v2_reservations LANGUAGE plpgsql AS $$
DECLARE
    account quota_v2_accounts;
    lease quota_v2_reservations;
    outstanding NUMERIC;
    available BIGINT;
    additional BIGINT;
    delta BIGINT;
    revoked BOOLEAN;
BEGIN
    IF p_target < 0 OR p_target > 67108864 OR p_ack < 0 OR p_until <= NOW()
       OR p_until > NOW() + INTERVAL '7 days' THEN
        RAISE EXCEPTION 'invalid quota reservation request' USING ERRCODE='22023';
    END IF;
    SELECT * INTO STRICT account FROM quota_v2_accounts
      WHERE user_id=p_user AND epoch=p_epoch FOR UPDATE;
    IF account.closed THEN
        RAISE EXCEPTION 'closed quota epoch' USING ERRCODE='22023';
    END IF;
    INSERT INTO quota_v2_reservations(
       user_id,epoch,node_id,meter_epoch,reservation_id,acknowledged_bytes,ceiling_bytes,valid_until)
      VALUES(p_user,p_epoch,p_node,p_meter,p_id,p_ack,p_ack,p_until)
      ON CONFLICT(user_id,epoch,node_id,meter_epoch) DO NOTHING;
    SELECT * INTO STRICT lease FROM quota_v2_reservations
      WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node AND meter_epoch=p_meter
      FOR UPDATE;
    -- Replayed requests cannot substitute a different lease identity.
    IF lease.reservation_id != p_id THEN
        RAISE EXCEPTION 'reservation identity mismatch' USING ERRCODE='22023';
    END IF;
    -- A physical Xray connection may finish a few bytes past the ceiling.
    -- Record ALL verified overshoot as spent, NEVER as new free allowance.
    -- Subsequent grants still require unreserved global capacity.
    IF p_ack > lease.ceiling_bytes THEN
        UPDATE quota_v2_reservations SET ceiling_bytes=p_ack
          WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node AND meter_epoch=p_meter
          RETURNING * INTO lease;
    END IF;
    -- A conservative burn charged the previously outstanding allowance
    -- in full WITHOUT claiming Node spent those bytes. Later genuine signed
    -- receipts up to that floor must not charge the user a second time.
    delta := GREATEST(p_ack-GREATEST(lease.acknowledged_bytes,
                                     lease.conservative_burn_floor_bytes),0);
    IF delta > 0 THEN
        UPDATE quota_v2_accounts SET settled_bytes=settled_bytes+delta
          WHERE user_id=p_user AND epoch=p_epoch RETURNING * INTO account;
    END IF;
    IF p_ack > lease.acknowledged_bytes THEN
        UPDATE quota_v2_reservations SET acknowledged_bytes=p_ack
          WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node AND meter_epoch=p_meter
          RETURNING * INTO lease;
    END IF;
    SELECT COALESCE(SUM(ceiling_bytes::NUMERIC
                      -GREATEST(acknowledged_bytes,conservative_burn_floor_bytes)),0)
      INTO outstanding FROM quota_v2_reservations
      WHERE user_id=p_user AND epoch=p_epoch;
    available := GREATEST(
        account.limit_bytes::NUMERIC
        - GREATEST(account.settled_bytes,account.observed_floor_bytes)
        - outstanding,0)::BIGINT;
    -- The operator's durable revocation intent is serialized by the SAME
    -- account and lease locks held above. Never renew the validity window
    -- or issue more capacity after it exists. Expiry itself never refunds.
    SELECT EXISTS (
        SELECT 1 FROM quota_v2_revocation_requests r
        WHERE r.user_id=p_user AND r.epoch=p_epoch AND r.node_id=p_node
          AND r.meter_epoch=p_meter AND r.reservation_id=p_id
    ) INTO revoked;
    -- target is outstanding capacity, NOT a fresh grant on every policy poll.
    additional := CASE WHEN revoked THEN 0
        ELSE LEAST(GREATEST(p_target-(lease.ceiling_bytes-lease.acknowledged_bytes),0),available)
    END;
    UPDATE quota_v2_reservations
       SET ceiling_bytes=ceiling_bytes+additional,
           revision=revision+1,
           valid_until=CASE WHEN revoked THEN valid_until
                            ELSE GREATEST(valid_until,p_until) END
     WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node AND meter_epoch=p_meter
     RETURNING * INTO lease;
    RETURN lease;
END;
$$;

CREATE OR REPLACE FUNCTION quota_v2_ack(
    p_user BIGINT, p_epoch UUID, p_node BIGINT, p_meter UUID,
    p_id UUID, p_total BIGINT
) RETURNS quota_v2_reservations LANGUAGE plpgsql AS $$
DECLARE
    account quota_v2_accounts;
    lease quota_v2_reservations;
    delta BIGINT;
BEGIN
    IF p_total < 0 THEN
        RAISE EXCEPTION 'invalid quota receipt' USING ERRCODE='22023';
    END IF;
    SELECT * INTO STRICT account FROM quota_v2_accounts
      WHERE user_id=p_user AND epoch=p_epoch FOR UPDATE;
    SELECT * INTO STRICT lease FROM quota_v2_reservations
      WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node AND meter_epoch=p_meter
      FOR UPDATE;
    IF lease.reservation_id != p_id THEN
        RAISE EXCEPTION 'quota receipt lease identity mismatch' USING ERRCODE='22023';
    END IF;
    delta := GREATEST(p_total-GREATEST(lease.acknowledged_bytes,
                                       lease.conservative_burn_floor_bytes),0);
    IF delta > 0 THEN
        UPDATE quota_v2_accounts
           SET settled_bytes=settled_bytes+delta
         WHERE user_id=p_user AND epoch=p_epoch;
    END IF;
    IF p_total > lease.acknowledged_bytes THEN
        UPDATE quota_v2_reservations
           SET acknowledged_bytes=p_total,
               -- Signed overrun above a burned floor remains chargeable.
               ceiling_bytes=GREATEST(ceiling_bytes,p_total)
         WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node AND meter_epoch=p_meter
         RETURNING * INTO lease;
    END IF;
    RETURN lease;
END;
$$;
-- Entire outstanding reserve is irreversibly CHARGED, not refunded.
-- No Node stop or Xray final meter is claimed. This conservative operator
-- escape hatch must never create new spending capacity for another Node.
CREATE FUNCTION quota_v2_burn_revoked(
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
    amount := lease.ceiling_bytes-lease.acknowledged_bytes;
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
