-- Quota V2: immutable, NON-AUTHORIZING evidence staging.
--
-- This is *not* a migration for activating quota v2, reissuing a user's
-- Xray admission, acknowledging old bytes, or allowing any refund.
-- Only a future separately authenticated proof-verifying backend may call
-- quota_v2_record_nonfinal_rollover_prepare. The SQL caller itself cannot
-- authenticate a Node signature nor the old Xray byte WAL. A direct SQL
-- caller cannot gain or return one byte, irrespective of stored evidence.
--
-- One immutable candidate per exact reservation. Old process source digest
-- cannot be re-used to invent a second accepted candidate in another slot.
CREATE TABLE quota_v2_nonfinal_rollover_preparations (
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
    old_container_id TEXT NOT NULL CHECK (
        old_container_id ~ '^[0-9a-f]{64}$' AND
        old_container_id <> repeat('0',64)),
    old_started_at TEXT NOT NULL CHECK (
        length(old_started_at) BETWEEN 15 AND 64 AND
        position('T' IN old_started_at) > 0),
    proposal_sha256 TEXT NOT NULL UNIQUE CHECK (
        proposal_sha256 ~ '^[0-9a-f]{64}$' AND
        proposal_sha256 <> repeat('0',64)),
    stop_sha256 TEXT NOT NULL CHECK (
        stop_sha256 ~ '^[0-9a-f]{64}$' AND
        stop_sha256 <> repeat('0',64)),
    xray_journal_sha256 TEXT NOT NULL CHECK (
        xray_journal_sha256 ~ '^[0-9a-f]{64}$' AND
        xray_journal_sha256 <> repeat('0',64)),
    node_durable_absolute_floor_bytes BIGINT NOT NULL
        CHECK (node_durable_absolute_floor_bytes >= 0),
    observed_uplink_bytes BIGINT NOT NULL CHECK (observed_uplink_bytes >= 0),
    observed_downlink_bytes BIGINT NOT NULL CHECK (observed_downlink_bytes >= 0),
    staged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(user_id,epoch,node_id,meter_epoch),
    FOREIGN KEY(user_id,epoch,node_id,meter_epoch)
      REFERENCES quota_v2_reservations(user_id,epoch,node_id,meter_epoch)
);

-- No 'approved', 'refundable', 'applied', 'remaining' or 'released' column.
-- This table MUST NOT participate in global available capacity arithmetic.
CREATE FUNCTION quota_v2_nonfinal_rollover_prepare_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'nonfinal rollover preparation may not be changed or removed'
        USING ERRCODE='22023';
END;
$$;
CREATE TRIGGER quota_v2_nonfinal_rollover_prepare_immutable_trg
BEFORE UPDATE OR DELETE ON quota_v2_nonfinal_rollover_preparations
FOR EACH ROW EXECUTE FUNCTION quota_v2_nonfinal_rollover_prepare_immutable();

CREATE FUNCTION quota_v2_record_nonfinal_rollover_prepare(
    p_user BIGINT, p_epoch UUID, p_node BIGINT, p_meter UUID,
    p_reservation UUID, p_revocation UUID, p_revision BIGINT,
    p_runtime TEXT, p_container TEXT, p_started TEXT,
    p_proposal_sha TEXT, p_stop_sha TEXT, p_wal_sha TEXT,
    p_node_floor BIGINT, p_up BIGINT, p_down BIGINT
) RETURNS quota_v2_nonfinal_rollover_preparations
LANGUAGE plpgsql AS $$
DECLARE
    lease quota_v2_reservations;
    revocation quota_v2_revocation_requests;
    existing quota_v2_nonfinal_rollover_preparations;
BEGIN
    IF p_user IS NULL OR p_user <= 0 OR p_node IS NULL OR p_node <= 0 OR
       p_epoch IS NULL OR p_meter IS NULL OR p_reservation IS NULL OR
       p_revocation IS NULL OR p_revision IS NULL OR p_revision <= 0 OR
       p_runtime IS NULL OR p_runtime !~ '^[0-9a-f]{64}$' OR
       p_container IS NULL OR p_container !~ '^[0-9a-f]{64}$' OR
       p_proposal_sha IS NULL OR p_proposal_sha !~ '^[0-9a-f]{64}$' OR
       p_stop_sha IS NULL OR p_stop_sha !~ '^[0-9a-f]{64}$' OR
       p_wal_sha IS NULL OR p_wal_sha !~ '^[0-9a-f]{64}$' OR
       p_runtime=repeat('0',64) OR p_container=repeat('0',64) OR
       p_proposal_sha=repeat('0',64) OR p_stop_sha=repeat('0',64) OR
       p_wal_sha=repeat('0',64) OR
       p_started IS NULL OR length(p_started) NOT BETWEEN 15 AND 64 OR
       position('T' IN p_started)=0 OR
       p_node_floor IS NULL OR p_node_floor < 0 OR
       p_up IS NULL OR p_up < 0 OR p_down IS NULL OR p_down < 0 OR
       p_up > 9223372036854775807-p_down THEN
        RAISE EXCEPTION 'invalid NONFINAL rollover preparation envelope'
            USING ERRCODE='22023';
    END IF;

    -- Identical lock order to quota_v2_reserve, ack and terminal quarantine.
    -- A stalled or parallel writer cannot claim a different reservation.
    SELECT * INTO STRICT lease FROM quota_v2_reservations
      WHERE user_id=p_user AND epoch=p_epoch AND
            node_id=p_node AND meter_epoch=p_meter FOR UPDATE;
    IF lease.reservation_id IS DISTINCT FROM p_reservation OR
       lease.revision < p_revision OR
       lease.node_confirmed IS NOT TRUE THEN
        RAISE EXCEPTION 'rollover preparation reservation not confirmed'
            USING ERRCODE='22023';
    END IF;
    SELECT * INTO revocation FROM quota_v2_revocation_requests
      WHERE user_id=p_user AND epoch=p_epoch AND
            node_id=p_node AND meter_epoch=p_meter AND
            reservation_id=p_reservation AND request_id=p_revocation FOR UPDATE;
    IF NOT FOUND OR revocation.applied_at IS NULL OR
       revocation.applied_revision IS DISTINCT FROM p_revision THEN
        RAISE EXCEPTION 'signed old-Xray revocation must already be applied'
            USING ERRCODE='22023';
    END IF;
    SELECT * INTO existing FROM quota_v2_nonfinal_rollover_preparations
      WHERE user_id=p_user AND epoch=p_epoch AND
            node_id=p_node AND meter_epoch=p_meter FOR UPDATE;
    IF FOUND THEN
        IF existing.reservation_id IS DISTINCT FROM p_reservation OR
           existing.revocation_id IS DISTINCT FROM p_revocation OR
           existing.applied_revision IS DISTINCT FROM p_revision OR
           existing.old_xray_runtime_id IS DISTINCT FROM p_runtime OR
           existing.old_container_id IS DISTINCT FROM p_container OR
           existing.old_started_at IS DISTINCT FROM p_started OR
           existing.proposal_sha256 IS DISTINCT FROM p_proposal_sha OR
           existing.stop_sha256 IS DISTINCT FROM p_stop_sha OR
           existing.xray_journal_sha256 IS DISTINCT FROM p_wal_sha OR
           existing.node_durable_absolute_floor_bytes IS DISTINCT FROM p_node_floor OR
           existing.observed_uplink_bytes IS DISTINCT FROM p_up OR
           existing.observed_downlink_bytes IS DISTINCT FROM p_down THEN
            RAISE EXCEPTION 'conflicting NONFINAL rollover proposal replay'
                USING ERRCODE='22023';
        END IF;
        RETURN existing;
    END IF;
    INSERT INTO quota_v2_nonfinal_rollover_preparations (
      user_id,epoch,node_id,meter_epoch,reservation_id,revocation_id,
      applied_revision,old_xray_runtime_id,old_container_id,old_started_at,
      proposal_sha256,stop_sha256,xray_journal_sha256,
      node_durable_absolute_floor_bytes,observed_uplink_bytes,observed_downlink_bytes
    ) VALUES (
      p_user,p_epoch,p_node,p_meter,p_reservation,p_revocation,p_revision,
      p_runtime,p_container,p_started,p_proposal_sha,p_stop_sha,p_wal_sha,
      p_node_floor,p_up,p_down
    ) RETURNING * INTO existing;
    RETURN existing;
END;
$$;

REVOKE ALL ON quota_v2_nonfinal_rollover_preparations FROM PUBLIC;
REVOKE ALL ON FUNCTION quota_v2_record_nonfinal_rollover_prepare(
    BIGINT,UUID,BIGINT,UUID,UUID,UUID,BIGINT,
    TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT
) FROM PUBLIC;

COMMENT ON TABLE quota_v2_nonfinal_rollover_preparations IS
'NONFINAL AUDIT ONLY. Immutable prepared proof identity: NEVER unfreezes users, alters bytes, releases reservation, or authorizes settlement.';
COMMENT ON FUNCTION quota_v2_record_nonfinal_rollover_prepare(
    BIGINT,UUID,BIGINT,UUID,UUID,UUID,BIGINT,
    TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT
) IS
'NON-AUTHORIZING per-reservation immutable staging. SQL does NOT verify signatures or Xray physical finality. No production API or automatic application path. Terminal settlement remains quarantined by migration 0132.';
