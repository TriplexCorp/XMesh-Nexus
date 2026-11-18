-- Quota v2: dormant terminal-settlement primitive for a FUTURE independently
-- verified signed Node final meter. Do NOT call with ordinary quotaStopReceipts
-- or CI-only observed Xray checkpoints. Those are nonterminal.
--
-- No HTTP endpoint or Node uploader invokes this function in this release.
-- Application must verify Ed25519 identity, exact lease/revision, committed
-- Xray stop, runtime/absolute monotonic finality and proof replay watermark
-- BEFORE invoking it. SQL cannot itself verify these physical facts.
--
-- The user account lock is the global allocation serializer. One immutable
-- settlement per reservation ensures idempotent repeat even after epoch close.
CREATE TABLE quota_v2_terminal_settlements (
    user_id BIGINT NOT NULL,
    epoch UUID NOT NULL,
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    meter_epoch UUID NOT NULL,
    reservation_id UUID NOT NULL,
    request_id UUID NOT NULL UNIQUE,
    applied_revision BIGINT NOT NULL CHECK (applied_revision > 0),
    xray_runtime_id TEXT NOT NULL CHECK (
        xray_runtime_id ~ '^[0-9a-f]{64}$' AND
        xray_runtime_id <> repeat('0',64)),
    proof_digest TEXT NOT NULL CHECK (
        proof_digest ~ '^[0-9a-f]{64}$' AND
        proof_digest <> repeat('0',64)),
    final_used_bytes BIGINT NOT NULL CHECK (final_used_bytes >= 0),
    refunded_bytes BIGINT NOT NULL CHECK (refunded_bytes >= 0),
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(user_id,epoch,node_id,meter_epoch),
    FOREIGN KEY(user_id,epoch,node_id,meter_epoch)
      REFERENCES quota_v2_reservations(user_id,epoch,node_id,meter_epoch)
);

-- This function does NOT authenticate p_digest. It is safe to use ONLY from
-- a future trusted handler following independent finality verification.
-- Raw SQL callers and existing Node "stop applied" reports are NOT evidence.
CREATE FUNCTION quota_v2_settle_verified_terminal(
    p_user BIGINT, p_epoch UUID, p_node BIGINT, p_meter UUID,
    p_reservation UUID, p_request UUID, p_revision BIGINT,
    p_runtime TEXT, p_digest TEXT, p_total BIGINT
) RETURNS quota_v2_terminal_settlements LANGUAGE plpgsql AS $$
DECLARE
    account quota_v2_accounts;
    lease quota_v2_reservations;
    intent quota_v2_revocation_requests;
    existing quota_v2_terminal_settlements;
    accepted quota_v2_terminal_settlements;
    spent_delta BIGINT;
    freed BIGINT;
BEGIN
    IF p_user <= 0 OR p_node <= 0 OR p_total < 0 OR p_revision <= 0
       OR p_runtime IS NULL OR p_digest IS NULL
       OR p_runtime !~ '^[0-9a-f]{64}$' OR p_digest !~ '^[0-9a-f]{64}$'
       OR p_runtime=repeat('0',64) OR p_digest=repeat('0',64) THEN
        RAISE EXCEPTION 'invalid terminal proof envelope' USING ERRCODE='22023';
    END IF;
    -- Lock ordering matches signed reservations, receipts and burns.
    SELECT * INTO STRICT account FROM quota_v2_accounts
      WHERE user_id=p_user AND epoch=p_epoch FOR UPDATE;
    SELECT * INTO STRICT lease FROM quota_v2_reservations
      WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node
        AND meter_epoch=p_meter FOR UPDATE;
    IF lease.reservation_id IS DISTINCT FROM p_reservation THEN
        RAISE EXCEPTION 'terminal reservation identity mismatch'
            USING ERRCODE='22023';
    END IF;

    -- The first accepted tuple is immutable. Retry is read-only even if
    -- the account closed after settlement; any mutation is a failed replay.
    SELECT * INTO existing FROM quota_v2_terminal_settlements
      WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node
        AND meter_epoch=p_meter FOR UPDATE;
    IF FOUND THEN
        IF existing.reservation_id IS DISTINCT FROM p_reservation OR
           existing.request_id IS DISTINCT FROM p_request OR
           existing.applied_revision <> p_revision OR
           existing.xray_runtime_id <> p_runtime OR
           existing.proof_digest <> p_digest OR
           existing.final_used_bytes <> p_total THEN
            RAISE EXCEPTION 'terminal settlement conflicting replay'
                USING ERRCODE='22023';
        END IF;
        RETURN existing;
    END IF;
    IF account.closed OR NOT lease.node_confirmed OR
       lease.conservative_burned_at IS NOT NULL OR
       lease.conservative_burn_floor_bytes <> 0 THEN
        RAISE EXCEPTION 'terminal settlement not eligible'
            USING ERRCODE='22023';
    END IF;
    SELECT * INTO intent FROM quota_v2_revocation_requests
      WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node
        AND meter_epoch=p_meter AND reservation_id=p_reservation
        AND request_id=p_request FOR UPDATE;
    IF NOT FOUND OR intent.applied_at IS NULL OR
       intent.applied_revision IS DISTINCT FROM p_revision OR
       lease.revision < p_revision THEN
        RAISE EXCEPTION 'verified applied revocation required'
            USING ERRCODE='22023';
    END IF;
    -- A raw reading below an already authenticated cumulative receipt
    -- must never decrease settled usage or produce a fabricated refund.
    IF p_total < lease.acknowledged_bytes OR
       p_total < COALESCE(intent.observed_used_bytes,0) THEN
        RAISE EXCEPTION 'terminal meter is below accepted usage'
            USING ERRCODE='22023';
    END IF;
    spent_delta := p_total - lease.acknowledged_bytes;
    freed := GREATEST(lease.ceiling_bytes - p_total,0);
    -- Charge verified overrun, rather than presenting it as new capacity.
    UPDATE quota_v2_accounts
      SET settled_bytes=settled_bytes+spent_delta
      WHERE user_id=p_user AND epoch=p_epoch;
    UPDATE quota_v2_reservations
      SET acknowledged_bytes=p_total,
          ceiling_bytes=p_total
      WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node
        AND meter_epoch=p_meter;
    -- The revocation's nonterminal observed floor is retained for audit.
    INSERT INTO quota_v2_terminal_settlements
      (user_id,epoch,node_id,meter_epoch,reservation_id,request_id,
       applied_revision,xray_runtime_id,proof_digest,
       final_used_bytes,refunded_bytes)
      VALUES
      (p_user,p_epoch,p_node,p_meter,p_reservation,p_request,
       p_revision,p_runtime,p_digest,p_total,freed)
      RETURNING * INTO accepted;
    RETURN accepted;
END;
$$;

-- Explicitly deny unprivileged callers; the migration owner retains access.
-- The future trusted backend MUST verify signature and dataplane finality
-- before it ever invokes this dormant primitive.
REVOKE ALL ON FUNCTION quota_v2_settle_verified_terminal(
    BIGINT,UUID,BIGINT,UUID,UUID,UUID,BIGINT,TEXT,TEXT,BIGINT)
  FROM PUBLIC;
REVOKE ALL ON TABLE quota_v2_terminal_settlements FROM PUBLIC;
