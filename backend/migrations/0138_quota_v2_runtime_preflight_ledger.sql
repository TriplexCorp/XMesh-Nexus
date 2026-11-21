-- Staging-only, ZERO-AUTHORITY durable snapshot that joins an EXISTING
-- PostgreSQL-serialized quota v2 lease with an exact prepared Xray genesis.
-- Does not allocate, renew, settle, refund, sign, or authorize a single byte.
-- No HTTP route or Xray open-listener integration is provided by this schema.
--
-- Important: the reported runtime/PID/policy/WAL fields come from a future
-- independently authenticated Node preflight. PostgreSQL alone does not
-- attest a Linux process, verify the complete fsynced Xray WAL or sign a
-- positive grant. A successful row MUST remain can_start=FALSE.
CREATE TABLE quota_v2_runtime_admission_preflights (
    user_id BIGINT NOT NULL CHECK (user_id>0),
    epoch UUID NOT NULL,
    node_id BIGINT NOT NULL CHECK (node_id>0),
    meter_epoch UUID NOT NULL,
    reservation_id UUID NOT NULL,
    revision BIGINT NOT NULL CHECK (revision>0),
    request_challenge TEXT NOT NULL CHECK (request_challenge ~ '^[0-9a-f]{64}$'),
    prepared_runtime_id TEXT NOT NULL CHECK (prepared_runtime_id ~ '^[0-9a-f]{64}$'),
    reported_container_id TEXT NOT NULL CHECK (reported_container_id ~ '^[0-9a-f]{64}$'),
    reported_pid BIGINT NOT NULL CHECK (reported_pid>0),
    reported_policy_sha256 TEXT NOT NULL CHECK (reported_policy_sha256 ~ '^[0-9a-f]{64}$'),
    first_activation_sha256 TEXT NOT NULL CHECK (first_activation_sha256 ~ '^[0-9a-f]{64}$'),
    reported_wal_floor_bytes BIGINT NOT NULL CHECK (reported_wal_floor_bytes>=0),
    account_limit_bytes BIGINT NOT NULL CHECK (account_limit_bytes>=0),
    account_floor_bytes BIGINT NOT NULL CHECK (account_floor_bytes>=0),
    all_node_held_bytes BIGINT NOT NULL CHECK (all_node_held_bytes>=0),
    lease_acknowledged_bytes BIGINT NOT NULL CHECK (lease_acknowledged_bytes>=0),
    lease_ceiling_bytes BIGINT NOT NULL
      CHECK (lease_ceiling_bytes>lease_acknowledged_bytes),
    expires_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    authorized_bytes BIGINT NOT NULL DEFAULT 0 CHECK (authorized_bytes=0),
    can_start BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT can_start),
    can_resume BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT can_resume),
    final_meter_verified BOOLEAN NOT NULL DEFAULT FALSE CHECK (NOT final_meter_verified),
    refundable_bytes BIGINT NOT NULL DEFAULT 0 CHECK (refundable_bytes=0),
    PRIMARY KEY(node_id,request_challenge),
    FOREIGN KEY(user_id,epoch,node_id,meter_epoch)
      REFERENCES quota_v2_reservations(user_id,epoch,node_id,meter_epoch),
    CHECK (reported_wal_floor_bytes >= lease_acknowledged_bytes),
    CHECK (reported_wal_floor_bytes <= lease_ceiling_bytes),
    CHECK (account_floor_bytes + all_node_held_bytes <= account_limit_bytes)
);

CREATE FUNCTION quota_v2_runtime_preflight_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'non-authorizing runtime preflight evidence is immutable'
      USING ERRCODE='22023';
END;
$$;
CREATE TRIGGER quota_v2_runtime_preflight_row_immutable
BEFORE UPDATE OR DELETE ON quota_v2_runtime_admission_preflights
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();
CREATE TRIGGER quota_v2_runtime_preflight_no_truncate
BEFORE TRUNCATE ON quota_v2_runtime_admission_preflights
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

-- Must only be invoked after independent enrolled XSP/2 identity, signed
-- policy digest, measured live process, authenticated WAL head, and policy
-- scope verification by a FUTURE trusted server workflow. None is done by
-- SQL itself and no caller can obtain authority from this function.
CREATE FUNCTION quota_v2_record_runtime_admission_preflight(
    p_user BIGINT, p_epoch UUID, p_node BIGINT, p_meter UUID, p_reservation UUID,
    p_revision BIGINT, p_challenge TEXT, p_runtime TEXT, p_container TEXT,
    p_pid BIGINT, p_policy_sha TEXT, p_activation TEXT, p_wal_floor BIGINT
) RETURNS quota_v2_runtime_admission_preflights LANGUAGE plpgsql AS $$
DECLARE
    account quota_v2_accounts;
    lease quota_v2_reservations;
    genesis quota_v2_xray_genesis;
    old quota_v2_runtime_admission_preflights;
    saved quota_v2_runtime_admission_preflights;
    held NUMERIC;
    floor_bytes BIGINT;
    now_at TIMESTAMPTZ;
BEGIN
    IF p_user IS NULL OR p_user<=0 OR p_node IS NULL OR p_node<=0
       OR p_epoch IS NULL OR p_meter IS NULL OR p_reservation IS NULL
       OR p_revision IS NULL OR p_revision<=0
       OR p_challenge IS NULL OR p_challenge !~ '^[0-9a-f]{64}$'
       OR p_runtime IS NULL OR p_runtime !~ '^[0-9a-f]{64}$'
       OR p_container IS NULL OR p_container !~ '^[0-9a-f]{64}$'
       OR p_pid IS NULL OR p_pid<=0
       OR p_policy_sha IS NULL OR p_policy_sha !~ '^[0-9a-f]{64}$'
       OR p_activation IS NULL OR p_activation !~ '^[0-9a-f]{64}$'
       OR p_wal_floor IS NULL OR p_wal_floor<0 THEN
        RAISE EXCEPTION 'invalid nonauthorizing Xray preflight'
          USING ERRCODE='22023';
    END IF;
    -- A prepared record must not be acknowledged and then vanish on
    -- an asynchronous PostgreSQL crash/restart. The caller must COMMIT its
    -- transaction before returning any signed preflight reply.
    PERFORM set_config('synchronous_commit','on',true);
    -- Preserve the existing global reservation lock ordering. Every v2
    -- allocator and settlement first locks the account, then the lease.
    SELECT * INTO STRICT account FROM quota_v2_accounts
      WHERE user_id=p_user AND epoch=p_epoch FOR UPDATE;
    IF account.closed OR account.limit_bytes<=0 THEN
        RAISE EXCEPTION 'closed or unlimited account cannot stage admission'
          USING ERRCODE='22023';
    END IF;
    SELECT * INTO STRICT lease FROM quota_v2_reservations
      WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node
        AND meter_epoch=p_meter FOR UPDATE;
    now_at:=clock_timestamp();
    IF lease.reservation_id IS DISTINCT FROM p_reservation
       OR lease.revision IS DISTINCT FROM p_revision
       OR NOT lease.node_confirmed
       OR lease.ceiling_bytes<=lease.acknowledged_bytes
       OR lease.valid_until<=now_at
       OR lease.conservative_burn_floor_bytes<>0
       OR lease.conservative_burned_at IS NOT NULL
       OR p_wal_floor<lease.acknowledged_bytes
       OR p_wal_floor>lease.ceiling_bytes THEN
        RAISE EXCEPTION 'unconfirmed, expired or mismatched quota lease'
          USING ERRCODE='22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM quota_v2_revocation_requests
         WHERE user_id=p_user AND epoch=p_epoch AND node_id=p_node
           AND meter_epoch=p_meter AND reservation_id=p_reservation
    ) THEN
        RAISE EXCEPTION 'revoked quota lease cannot prepare Xray'
          USING ERRCODE='22023';
    END IF;
    SELECT * INTO STRICT genesis FROM quota_v2_xray_genesis
      WHERE node_id=p_node FOR SHARE;
    IF genesis.first_activation_sha256 IS DISTINCT FROM p_activation
       OR genesis.runtime_id IS DISTINCT FROM p_runtime
       OR genesis.prepared_ms IS NULL
       OR genesis.challenge IS NULL
       OR genesis.receipt_signature IS NULL
       OR (EXTRACT(EPOCH FROM now_at)*1000)::BIGINT<genesis.prepared_ms
       OR (EXTRACT(EPOCH FROM now_at)*1000)::BIGINT>=genesis.prepared_ms+120000 THEN
        RAISE EXCEPTION 'no current one-shot prepared Xray identity'
          USING ERRCODE='22023';
    END IF;
    -- Across *every* active/closed epoch, unresolved old signed capacity
    -- is never discarded. Account lock serializes competing Node grants.
    IF EXISTS (
        SELECT 1 FROM quota_v2_reservations AS oldlease
        JOIN quota_v2_accounts AS oldaccount USING(user_id,epoch)
         WHERE oldlease.user_id=p_user AND oldaccount.closed
           AND oldlease.ceiling_bytes>
             GREATEST(oldlease.acknowledged_bytes,oldlease.conservative_burn_floor_bytes)
    ) THEN
        RAISE EXCEPTION 'unresolved old quota epoch'
          USING ERRCODE='22023';
    END IF;
    SELECT COALESCE(SUM(GREATEST(
        r.ceiling_bytes::NUMERIC-GREATEST(r.acknowledged_bytes,r.conservative_burn_floor_bytes),0
    )),0) INTO held FROM quota_v2_reservations r
      WHERE r.user_id=p_user AND r.epoch=p_epoch;
    floor_bytes:=GREATEST(account.settled_bytes,account.observed_floor_bytes);
    IF floor_bytes::NUMERIC+held>account.limit_bytes
        OR held>9223372036854775807 THEN
        RAISE EXCEPTION 'existing reservations exceed shared quota'
          USING ERRCODE='22023';
    END IF;
    -- A challenge used for a prior Node candidate cannot be reassigned.
    -- Same-revision, same-challenge retries are byte-identical, and a
    -- later revision cannot silently extend the prior snapshot.
    SELECT * INTO old FROM quota_v2_runtime_admission_preflights
      WHERE node_id=p_node AND request_challenge=p_challenge;
    IF FOUND THEN
        IF ROW(old.user_id,old.epoch,old.meter_epoch,old.reservation_id,
               old.revision,old.prepared_runtime_id,old.reported_container_id,
               old.reported_pid,old.reported_policy_sha256,
               old.first_activation_sha256,old.reported_wal_floor_bytes,
               old.account_limit_bytes,old.account_floor_bytes,
               old.all_node_held_bytes,old.lease_acknowledged_bytes,
               old.lease_ceiling_bytes) IS DISTINCT FROM
           ROW(p_user,p_epoch,p_meter,p_reservation,p_revision,p_runtime,
               p_container,p_pid,p_policy_sha,p_activation,p_wal_floor,
               account.limit_bytes,floor_bytes,held::BIGINT,
               lease.acknowledged_bytes,lease.ceiling_bytes) THEN
            RAISE EXCEPTION 'conflicting runtime candidate replay'
              USING ERRCODE='22023';
        END IF;
        RETURN old;
    END IF;
    INSERT INTO quota_v2_runtime_admission_preflights(
      user_id,epoch,node_id,meter_epoch,reservation_id,revision,request_challenge,
      prepared_runtime_id,reported_container_id,reported_pid,
      reported_policy_sha256,first_activation_sha256,reported_wal_floor_bytes,
      account_limit_bytes,account_floor_bytes,all_node_held_bytes,
      lease_acknowledged_bytes,lease_ceiling_bytes,expires_at
    ) VALUES(
      p_user,p_epoch,p_node,p_meter,p_reservation,p_revision,p_challenge,
      p_runtime,p_container,p_pid,p_policy_sha,p_activation,p_wal_floor,
      account.limit_bytes,floor_bytes,held::BIGINT,lease.acknowledged_bytes,
      lease.ceiling_bytes,LEAST(lease.valid_until,now_at+INTERVAL '120 seconds')
    ) RETURNING * INTO saved;
    RETURN saved;
END;
$$;

REVOKE ALL ON quota_v2_runtime_admission_preflights FROM PUBLIC;
REVOKE ALL ON FUNCTION quota_v2_record_runtime_admission_preflight(
 BIGINT,UUID,BIGINT,UUID,UUID,BIGINT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,BIGINT
) FROM PUBLIC;
COMMENT ON TABLE quota_v2_runtime_admission_preflights IS
'ZERO AUTHORITY. Durable snapshot of verified SQL lease/genesis consistency and UNVERIFIED Node PID/policy/WAL claims. No traffic activation, settlement or refund.';
COMMENT ON FUNCTION quota_v2_record_runtime_admission_preflight(
 BIGINT,UUID,BIGINT,UUID,UUID,BIGINT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,BIGINT
) IS
'No Ed25519 verification or runtime attestation in PostgreSQL. Preflight snapshots cannot authorize traffic. Positive Nexus/Xray gate requires independent signed evidence and writer finality.';
