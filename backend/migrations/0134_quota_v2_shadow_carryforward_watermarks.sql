-- Quota V2: immutable, atomic, NONAUTHORITATIVE shadow reconciliation.
--
-- Prior migrations 0133 and 0132 still mean:
--   1. the Node-signed old-Xray byte preparation has been *recorded*, not
--      acknowledged as a completed monetary carryforward;
--   2. terminal refund/settlement is DENIED, including for the DB owner.
--
-- Distinct independent sources (a cumulative Node absolute floor, volatile
-- per-runtime Xray uplink/downlink, an already acknowledged reservation and
-- the operator's irreversible burn floor) MAY OVERLAP. Their sum is NOT a
-- valid charge. Only their maximum is a nonadditive shadow candidate. The
-- value is permanently segregated from quota_v2_accounts and reservations.
-- It never affects available quota, settled bytes, acknowledged bytes,
-- reserved ceiling, subsequent allocation, or admission to Xray.
--
-- This intentionally does NOT handle multiple old runtimes' cumulative
-- accounting or prove every detached Xray writer finished. A later audited
-- trusted verifier and *different* SQL migration are required for any credit.
CREATE TABLE quota_v2_nonfinal_carryforward_watermarks (
    user_id BIGINT NOT NULL CHECK (user_id > 0),
    epoch UUID NOT NULL,
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    meter_epoch UUID NOT NULL,
    reservation_id UUID NOT NULL,
    revocation_id UUID NOT NULL,
    applied_revision BIGINT NOT NULL CHECK (applied_revision > 0),
    old_xray_runtime_id TEXT NOT NULL CHECK (
        old_xray_runtime_id ~ '^[0-9a-f]{64}$' AND
        old_xray_runtime_id <> repeat('0',64)),
    source_proposal_sha256 TEXT NOT NULL CHECK (
        source_proposal_sha256 ~ '^[0-9a-f]{64}$' AND
        source_proposal_sha256 <> repeat('0',64)),
    source_stop_sha256 TEXT NOT NULL CHECK (
        source_stop_sha256 ~ '^[0-9a-f]{64}$' AND
        source_stop_sha256 <> repeat('0',64)),
    source_xray_wal_sha256 TEXT NOT NULL CHECK (
        source_xray_wal_sha256 ~ '^[0-9a-f]{64}$' AND
        source_xray_wal_sha256 <> repeat('0',64)),
    prior_acknowledged_bytes BIGINT NOT NULL CHECK (prior_acknowledged_bytes >= 0),
    prior_conservative_burn_floor_bytes BIGINT NOT NULL CHECK (
        prior_conservative_burn_floor_bytes >= 0),
    node_absolute_floor_bytes BIGINT NOT NULL CHECK (node_absolute_floor_bytes >= 0),
    old_runtime_raw_observed_bytes BIGINT NOT NULL CHECK (
        old_runtime_raw_observed_bytes >= 0),
    -- This is a SHADOW candidate only: it is not an applied/billable balance.
    nonadditive_candidate_bytes BIGINT NOT NULL CHECK (
        nonadditive_candidate_bytes = GREATEST(
            prior_acknowledged_bytes,prior_conservative_burn_floor_bytes,
            node_absolute_floor_bytes,old_runtime_raw_observed_bytes)),
    staged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(user_id,epoch,node_id,meter_epoch),
    FOREIGN KEY(user_id,epoch,node_id,meter_epoch)
      REFERENCES quota_v2_nonfinal_rollover_preparations(
        user_id,epoch,node_id,meter_epoch),
    -- A source old runtime and WAL hash cannot be replayed as a different
    -- reservation for the same user on the same Node.
    UNIQUE(user_id,epoch,node_id,old_xray_runtime_id,source_xray_wal_sha256)
);

CREATE FUNCTION quota_v2_nonfinal_watermark_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'nonfinal quota shadow watermark is immutable'
        USING ERRCODE='22023';
END;
$$;

CREATE TRIGGER quota_v2_nonfinal_watermark_immutable_trg
BEFORE UPDATE OR DELETE ON quota_v2_nonfinal_carryforward_watermarks
FOR EACH ROW EXECUTE FUNCTION quota_v2_nonfinal_watermark_immutable();

CREATE FUNCTION quota_v2_record_nonfinal_shadow_watermark(
    p_user BIGINT,p_epoch UUID,p_node BIGINT,p_meter UUID,
    p_reservation UUID,p_revocation UUID,p_revision BIGINT,
    p_proposal_digest TEXT,p_stop_digest TEXT,p_wal_digest TEXT
) RETURNS quota_v2_nonfinal_carryforward_watermarks
LANGUAGE plpgsql AS $$
DECLARE
    account quota_v2_accounts;
    lease quota_v2_reservations;
    staged quota_v2_nonfinal_rollover_preparations;
    applied quota_v2_revocation_requests;
    prior quota_v2_nonfinal_carryforward_watermarks;
    saved quota_v2_nonfinal_carryforward_watermarks;
    raw_bytes BIGINT;
BEGIN
    IF p_user IS NULL OR p_user<=0 OR p_node IS NULL OR p_node<=0 OR
       p_epoch IS NULL OR p_meter IS NULL OR p_reservation IS NULL OR
       p_revocation IS NULL OR p_revision IS NULL OR p_revision<=0 OR
       p_proposal_digest IS NULL OR
       p_proposal_digest !~ '^[0-9a-f]{64}$' OR
       p_stop_digest IS NULL OR p_stop_digest !~ '^[0-9a-f]{64}$' OR
       p_wal_digest IS NULL OR p_wal_digest !~ '^[0-9a-f]{64}$' OR
       p_proposal_digest=repeat('0',64) OR
       p_stop_digest=repeat('0',64) OR p_wal_digest=repeat('0',64)
    THEN
        RAISE EXCEPTION 'invalid nonfinal Xray shadow source'
            USING ERRCODE='22023';
    END IF;

    -- Match reservation, ack and operator burn lock ordering. Serializing
    -- on this account+lease makes parallel staging and concurrent legitimate
    -- signed quota receipts deterministic. The SQL owner cannot directly
    -- turn this candidate into credits, releases or a new lease.
    SELECT * INTO STRICT account FROM quota_v2_accounts
      WHERE user_id=p_user AND epoch=p_epoch FOR UPDATE;
    SELECT * INTO STRICT lease FROM quota_v2_reservations
      WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node
        AND meter_epoch=p_meter FOR UPDATE;
    IF lease.reservation_id IS DISTINCT FROM p_reservation OR
       lease.node_confirmed IS NOT TRUE OR
       lease.revision < p_revision THEN
        RAISE EXCEPTION 'shadow watermark reservation not confirmed'
            USING ERRCODE='22023';
    END IF;

    SELECT * INTO STRICT staged FROM quota_v2_nonfinal_rollover_preparations
      WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node
        AND meter_epoch=p_meter FOR SHARE;
    IF staged.reservation_id IS DISTINCT FROM p_reservation OR
       staged.revocation_id IS DISTINCT FROM p_revocation OR
       staged.applied_revision IS DISTINCT FROM p_revision OR
       staged.proposal_sha256 IS DISTINCT FROM p_proposal_digest OR
       staged.stop_sha256 IS DISTINCT FROM p_stop_digest OR
       staged.xray_journal_sha256 IS DISTINCT FROM p_wal_digest THEN
        RAISE EXCEPTION 'source mismatch: signed old-Xray prepared evidence'
            USING ERRCODE='22023';
    END IF;
    SELECT * INTO applied FROM quota_v2_revocation_requests
      WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node
        AND meter_epoch=p_meter AND reservation_id=p_reservation
        AND request_id=p_revocation FOR UPDATE;
    IF NOT FOUND OR applied.applied_at IS NULL OR
       applied.applied_revision IS DISTINCT FROM p_revision THEN
        RAISE EXCEPTION 'shadow watermark requires applied old Xray stop'
            USING ERRCODE='22023';
    END IF;

    SELECT * INTO prior FROM quota_v2_nonfinal_carryforward_watermarks
      WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node
        AND meter_epoch=p_meter FOR UPDATE;
    IF FOUND THEN
        -- Exact retry is read-only, even after a later genuinely signed
        -- receipt has advanced the live reservation or the account closed.
        -- Divergent source or revision is a conflicting replay.
        IF prior.reservation_id IS DISTINCT FROM p_reservation OR
           prior.revocation_id IS DISTINCT FROM p_revocation OR
           prior.applied_revision IS DISTINCT FROM p_revision OR
           prior.source_proposal_sha256 IS DISTINCT FROM p_proposal_digest OR
           prior.source_stop_sha256 IS DISTINCT FROM p_stop_digest OR
           prior.source_xray_wal_sha256 IS DISTINCT FROM p_wal_digest OR
           prior.old_xray_runtime_id IS DISTINCT FROM staged.old_xray_runtime_id
        THEN
            RAISE EXCEPTION 'conflicting old-Xray shadow watermark replay'
                USING ERRCODE='22023';
        END IF;
        RETURN prior;
    END IF;

    -- Fail closed rather than silently overflow int64 or wrap negative.
    IF staged.observed_uplink_bytes >
       9223372036854775807-staged.observed_downlink_bytes THEN
        RAISE EXCEPTION 'invalid signed old-Xray shadow byte overflow'
            USING ERRCODE='22023';
    END IF;
    raw_bytes:=staged.observed_uplink_bytes+staged.observed_downlink_bytes;

    INSERT INTO quota_v2_nonfinal_carryforward_watermarks(
      user_id,epoch,node_id,meter_epoch,reservation_id,revocation_id,
      applied_revision,old_xray_runtime_id,source_proposal_sha256,
      source_stop_sha256,source_xray_wal_sha256,
      prior_acknowledged_bytes,prior_conservative_burn_floor_bytes,
      node_absolute_floor_bytes,old_runtime_raw_observed_bytes,
      nonadditive_candidate_bytes
    ) VALUES (
      p_user,p_epoch,p_node,p_meter,p_reservation,p_revocation,p_revision,
      staged.old_xray_runtime_id,p_proposal_digest,p_stop_digest,p_wal_digest,
      lease.acknowledged_bytes,lease.conservative_burn_floor_bytes,
      staged.node_durable_absolute_floor_bytes,raw_bytes,
      GREATEST(lease.acknowledged_bytes,
               lease.conservative_burn_floor_bytes,
               staged.node_durable_absolute_floor_bytes,raw_bytes)
    ) RETURNING * INTO saved;
    RETURN saved;
END;
$$;

REVOKE ALL ON quota_v2_nonfinal_carryforward_watermarks FROM PUBLIC;
REVOKE ALL ON FUNCTION quota_v2_record_nonfinal_shadow_watermark(
    BIGINT,UUID,BIGINT,UUID,UUID,UUID,BIGINT,TEXT,TEXT,TEXT
) FROM PUBLIC;
COMMENT ON TABLE quota_v2_nonfinal_carryforward_watermarks IS
'SHADOW ONLY; no applied carryforward, no additional credit/debit, no refund, no admission, no allowance release, no complete multi-runtime accounting. Immutable one-shot max candidate, never sum overlapping sources.';
COMMENT ON FUNCTION quota_v2_record_nonfinal_shadow_watermark(
    BIGINT,UUID,BIGINT,UUID,UUID,UUID,BIGINT,TEXT,TEXT,TEXT
) IS
'UNTRUSTED RAW SQL CALLS DO NOT VERIFY ED25519 OR OLD PID; staging never changes account/reservation or unblocks. Future authenticated handler required.';
