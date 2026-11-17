-- Quota protocol v2: reservations are held until authenticated settlement.
-- Expiry never silently refunds unknown offline consumption.
CREATE TABLE quota_v2_accounts (
    user_id BIGINT NOT NULL CHECK (user_id > 0),
    epoch UUID NOT NULL,
    limit_bytes BIGINT NOT NULL CHECK (limit_bytes >= 0),
    settled_bytes BIGINT NOT NULL DEFAULT 0 CHECK (settled_bytes >= 0),
    -- Verified aggregate telemetry may arrive ahead of signed Node receipts.
    -- Keep it as a FLOOR, not an additive charge, to avoid double spending.
    observed_floor_bytes BIGINT NOT NULL DEFAULT 0 CHECK (observed_floor_bytes >= 0),
    closed BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY(user_id,epoch)
);
CREATE UNIQUE INDEX quota_v2_one_open_epoch ON quota_v2_accounts(user_id) WHERE NOT closed;
CREATE TABLE quota_v2_reservations (
    user_id BIGINT NOT NULL,
    epoch UUID NOT NULL,
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    meter_epoch UUID NOT NULL,
    reservation_id UUID NOT NULL UNIQUE,
    acknowledged_bytes BIGINT NOT NULL DEFAULT 0 CHECK (acknowledged_bytes >= 0),
    ceiling_bytes BIGINT NOT NULL DEFAULT 0 CHECK (ceiling_bytes >= acknowledged_bytes),
    revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
    -- Two-step issuance: a prepared lease can never authorize spending
    -- until a later signed node request echoes this random lease identity.
    node_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    valid_until TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(user_id,epoch,node_id,meter_epoch),
    FOREIGN KEY(user_id,epoch) REFERENCES quota_v2_accounts(user_id,epoch)
);
-- Called only by authenticated control-plane code inside its transaction.
-- The caller owns identity, epoch, membership and signed-response validation.
CREATE FUNCTION quota_v2_reserve(
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
    delta := GREATEST(p_ack-lease.acknowledged_bytes,0);
    IF delta > 0 THEN
        UPDATE quota_v2_accounts SET settled_bytes=settled_bytes+delta
          WHERE user_id=p_user AND epoch=p_epoch RETURNING * INTO account;
        UPDATE quota_v2_reservations SET acknowledged_bytes=p_ack
          WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node AND meter_epoch=p_meter
          RETURNING * INTO lease;
    END IF;
    SELECT COALESCE(SUM(ceiling_bytes::NUMERIC-acknowledged_bytes),0)
      INTO outstanding FROM quota_v2_reservations
      WHERE user_id=p_user AND epoch=p_epoch;
    available := GREATEST(
        account.limit_bytes::NUMERIC
        - GREATEST(account.settled_bytes,account.observed_floor_bytes)
        - outstanding,0)::BIGINT;
    -- target is outstanding capacity, NOT a fresh grant on every policy poll.
    additional := LEAST(GREATEST(p_target-(lease.ceiling_bytes-lease.acknowledged_bytes),0),available);
    UPDATE quota_v2_reservations
       SET ceiling_bytes=ceiling_bytes+additional,
           revision=revision+1,
           valid_until=GREATEST(valid_until,p_until)
     WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node AND meter_epoch=p_meter
     RETURNING * INTO lease;
    RETURN lease;
END;
$$;

-- Settle independently authenticated node receipts; unlike reserve(), this
-- function never issues or renews any allowance. It is safe for delayed
-- receipts from an expired or closed epoch.
CREATE FUNCTION quota_v2_ack(
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
    delta := GREATEST(p_total-lease.acknowledged_bytes,0);
    IF delta > 0 THEN
        UPDATE quota_v2_accounts
           SET settled_bytes=settled_bytes+delta
         WHERE user_id=p_user AND epoch=p_epoch;
        UPDATE quota_v2_reservations
           SET acknowledged_bytes=p_total,
               -- Reconcile in-flight overshoot as consumed, NOT as a grant.
               ceiling_bytes=GREATEST(ceiling_bytes,p_total)
         WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node AND meter_epoch=p_meter
         RETURNING * INTO lease;
    END IF;
    RETURN lease;
END;
$$;
