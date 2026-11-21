-- CI/review stage: immutable first-genesis positive-cap SIGNED BYTES.
-- This migration never attaches a route or permits live Node authorization.
-- The Rust issuer must verify real XSP/2 provenance, exact Xray process,
-- user policy scope and WAL history before any production caller may use it.
CREATE TABLE quota_v2_signed_first_cap_outbox (
    node_id BIGINT NOT NULL CHECK(node_id>0),
    request_challenge TEXT NOT NULL CHECK(request_challenge ~ '^[0-9a-f]{64}$'),
    user_id BIGINT NOT NULL CHECK(user_id>0),
    epoch UUID NOT NULL,
    meter_epoch UUID NOT NULL,
    reservation_id UUID NOT NULL,
    revision BIGINT NOT NULL CHECK(revision>0),
    policy_sha256 TEXT NOT NULL CHECK(policy_sha256 ~ '^[0-9a-f]{64}$'),
    runtime_id TEXT NOT NULL CHECK(runtime_id ~ '^[0-9a-f]{64}$'),
    signer_public_key TEXT NOT NULL CHECK(signer_public_key ~ '^[0-9a-f]{64}$'),
    grant_bytes BIGINT NOT NULL CHECK(grant_bytes BETWEEN 1 AND 67108864),
    issued_at_ms BIGINT NOT NULL CHECK(issued_at_ms>0),
    install_before_ms BIGINT NOT NULL,
    valid_until_ms BIGINT NOT NULL,
    signed_envelope BYTEA NOT NULL CHECK(octet_length(signed_envelope) BETWEEN 100 AND 8192),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    can_start BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT can_start),
    can_resume BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT can_resume),
    refundable_bytes BIGINT NOT NULL DEFAULT 0 CHECK(refundable_bytes=0),
    PRIMARY KEY(node_id,request_challenge),
    UNIQUE(reservation_id,revision),
    FOREIGN KEY(node_id,request_challenge) REFERENCES quota_v2_runtime_admission_preflights(node_id,request_challenge),
    CHECK(install_before_ms>issued_at_ms AND valid_until_ms>install_before_ms)
);
CREATE TRIGGER quota_v2_signed_first_cap_immutable
BEFORE UPDATE OR DELETE ON quota_v2_signed_first_cap_outbox
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();
CREATE TRIGGER quota_v2_signed_first_cap_no_truncate
BEFORE TRUNCATE ON quota_v2_signed_first_cap_outbox
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE FUNCTION quota_v2_store_signed_first_cap(
 p_node BIGINT,p_challenge TEXT,p_signer_public_key TEXT,p_envelope BYTEA
) RETURNS quota_v2_signed_first_cap_outbox LANGUAGE plpgsql AS $$
DECLARE
  pre quota_v2_runtime_admission_preflights;
  account quota_v2_accounts;
  lease quota_v2_reservations;
  genesis quota_v2_xray_genesis;
  existing quota_v2_signed_first_cap_outbox;
  stored quota_v2_signed_first_cap_outbox;
  doc JSONB;
  payload JSONB;
  held NUMERIC;
  now_ms BIGINT;
  grant_value BIGINT;
  issued BIGINT;
  install_by BIGINT;
  expires BIGINT;
BEGIN
  IF p_node IS NULL OR p_node<=0 OR p_challenge IS NULL
     OR p_challenge !~ '^[0-9a-f]{64}$'
     OR p_signer_public_key IS NULL OR p_signer_public_key !~ '^[0-9a-f]{64}$'
     OR p_envelope IS NULL OR octet_length(p_envelope) NOT BETWEEN 100 AND 8192
     OR get_byte(p_envelope,octet_length(p_envelope)-1)<>10 THEN
    RAISE EXCEPTION 'invalid first Xray signed-cap envelope'
      USING ERRCODE='22023';
  END IF;
  PERFORM set_config('synchronous_commit','on',true);
  -- First read the immutable preflight, then lock in existing account ->
  -- reservation order, never the other way round.
  SELECT * INTO STRICT pre FROM quota_v2_runtime_admission_preflights
    WHERE node_id=p_node AND request_challenge=p_challenge;
  SELECT * INTO STRICT account FROM quota_v2_accounts
    WHERE user_id=pre.user_id AND epoch=pre.epoch FOR UPDATE;
  SELECT * INTO STRICT lease FROM quota_v2_reservations
    WHERE user_id=pre.user_id AND epoch=pre.epoch AND node_id=pre.node_id
      AND meter_epoch=pre.meter_epoch FOR UPDATE;
  SELECT * INTO STRICT genesis FROM quota_v2_xray_genesis
    WHERE node_id=pre.node_id FOR SHARE;
  now_ms:=(EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT;
  IF account.closed OR account.limit_bytes<=0
      OR lease.reservation_id IS DISTINCT FROM pre.reservation_id
      OR lease.revision IS DISTINCT FROM pre.revision
      OR NOT lease.node_confirmed OR lease.acknowledged_bytes<>0
      OR lease.ceiling_bytes IS DISTINCT FROM pre.lease_ceiling_bytes
      OR pre.lease_acknowledged_bytes<>0 OR pre.reported_wal_floor_bytes<>0
      OR lease.conservative_burn_floor_bytes<>0
      OR lease.conservative_burned_at IS NOT NULL
      OR lease.valid_until<clock_timestamp()
      OR pre.expires_at<clock_timestamp()
      OR pre.first_activation_sha256 IS DISTINCT FROM genesis.first_activation_sha256
      OR pre.prepared_runtime_id IS DISTINCT FROM genesis.runtime_id
      OR genesis.policy_path_used
      OR genesis.prepared_ms IS NULL
      OR now_ms>=genesis.prepared_ms+120000
      OR EXISTS(SELECT 1 FROM quota_v2_revocation_requests
         WHERE user_id=pre.user_id AND epoch=pre.epoch
           AND node_id=pre.node_id AND meter_epoch=pre.meter_epoch
           AND reservation_id=pre.reservation_id)
      OR EXISTS(SELECT 1 FROM quota_v2_reservations AS oldlease
         JOIN quota_v2_accounts AS oldaccount USING(user_id,epoch)
         WHERE oldlease.user_id=pre.user_id AND oldaccount.closed
           AND oldlease.ceiling_bytes>
             GREATEST(oldlease.acknowledged_bytes,oldlease.conservative_burn_floor_bytes))
  THEN
    RAISE EXCEPTION 'no current confirmed zero-WAL first-genesis reservation'
      USING ERRCODE='22023';
  END IF;
  SELECT COALESCE(SUM(GREATEST(
        ceiling_bytes::NUMERIC-GREATEST(acknowledged_bytes,conservative_burn_floor_bytes),0
      )),0) INTO held FROM quota_v2_reservations
       WHERE user_id=pre.user_id AND epoch=pre.epoch;
  IF held<>pre.all_node_held_bytes
      OR GREATEST(account.settled_bytes,account.observed_floor_bytes)
            <>pre.account_floor_bytes
      OR account.limit_bytes<>pre.account_limit_bytes
      OR held+GREATEST(account.settled_bytes,account.observed_floor_bytes)>account.limit_bytes THEN
    RAISE EXCEPTION 'signed-cap account budget changed since SQL preflight'
      USING ERRCODE='22023';
  END IF;
  BEGIN
    doc:=convert_from(p_envelope,'UTF8')::JSONB;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid canonical signed-cap JSON' USING ERRCODE='22023';
  END;
  payload:=doc->'payload';
  IF jsonb_typeof(doc)<>'object'
      OR (SELECT count(*) FROM jsonb_object_keys(doc))<>3
      OR doc->>'algorithm'<>'Ed25519'
      OR doc->>'signature' !~ '^[0-9a-f]{128}$'
      OR jsonb_typeof(payload)<>'object'
      OR payload->>'kind'<>'xmesh.quota-v2.xray-cap-admission'
      OR payload->>'schemaVersion'<>'1'
      OR payload->>'nodeId'<>p_node::TEXT
      OR payload->>'userId'<>pre.user_id::TEXT
      OR payload->>'nonce'<>p_challenge
      OR payload->>'policySha256'<>pre.reported_policy_sha256
      OR payload->>'runtimeId'<>pre.prepared_runtime_id
      OR payload->>'activationReceiptSha256'<>pre.first_activation_sha256
      OR payload->>'accountEpoch'<>pre.epoch::TEXT
      OR payload->>'meterEpoch'<>pre.meter_epoch::TEXT
      OR payload->>'reservationId'<>pre.reservation_id::TEXT
      OR payload->>'reservationRevision'<>pre.revision::TEXT
      OR payload->>'inventoryTailDigest'<>repeat('0',64)
      OR payload->>'witnessedWalBytes'<>'0'
      OR payload->>'witnessedCdnBytes'<>'0'
      OR payload->>'canSpend'<>'true'
      OR payload->>'canStart'<>'false'
      OR payload->>'canResume'<>'false'
      OR payload->>'finalMeterVerified'<>'false'
      OR payload->>'refundableBytes'<>'0'
      OR payload->>'sharedCeilingBytes'<>lease.ceiling_bytes::TEXT
      OR payload->>'nodeCeilingBytes'<>lease.ceiling_bytes::TEXT
  THEN
    RAISE EXCEPTION 'signed Xray cap differs from committed SQL reservation'
      USING ERRCODE='22023';
  END IF;
  -- Strict duplicate/unknown JSON keys are rejected in the Rust builder and
  -- Go Xray verifier. PostgreSQL JSONB checks are only defense in depth.
  BEGIN
    grant_value:=(payload->>'sharedCeilingBytes')::BIGINT;
    issued:=(payload->>'issuedAtMs')::BIGINT;
    install_by:=(payload->>'installBeforeMs')::BIGINT;
    expires:=(payload->>'validUntilMs')::BIGINT;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'non-integer signed-cap clock or budget' USING ERRCODE='22023';
  END;
  IF grant_value NOT BETWEEN 1 AND 67108864 OR issued>now_ms OR issued<now_ms-120000
     OR install_by<=now_ms OR install_by>now_ms+120000
     OR install_by>(EXTRACT(EPOCH FROM pre.expires_at)*1000)::BIGINT
     OR expires<=install_by
     OR expires>(EXTRACT(EPOCH FROM lease.valid_until)*1000)::BIGINT
     OR expires>issued+86400000 THEN
    RAISE EXCEPTION 'stale or overlong first-genesis signed cap'
      USING ERRCODE='22023';
  END IF;
  -- Do not re-sign/relabel the same reservation after losing a response.
  SELECT * INTO existing FROM quota_v2_signed_first_cap_outbox
    WHERE node_id=p_node AND request_challenge=p_challenge;
  IF FOUND THEN
    IF existing.signed_envelope<>p_envelope
       OR existing.signer_public_key<>p_signer_public_key THEN
      RAISE EXCEPTION 'conflicting signed-cap replay'
        USING ERRCODE='22023';
    END IF;
    RETURN existing;
  END IF;
  INSERT INTO quota_v2_signed_first_cap_outbox(
    node_id,request_challenge,user_id,epoch,meter_epoch,reservation_id,
    revision,policy_sha256,runtime_id,signer_public_key,grant_bytes,
    issued_at_ms,install_before_ms,valid_until_ms,signed_envelope
  ) VALUES(
    p_node,p_challenge,pre.user_id,pre.epoch,pre.meter_epoch,pre.reservation_id,
    pre.revision,pre.reported_policy_sha256,pre.prepared_runtime_id,
    p_signer_public_key,grant_value,issued,install_by,expires,p_envelope
  ) RETURNING * INTO stored;
  RETURN stored;
END;
$$;

REVOKE ALL ON quota_v2_signed_first_cap_outbox FROM PUBLIC;
REVOKE ALL ON FUNCTION quota_v2_store_signed_first_cap(
  BIGINT,TEXT,TEXT,BYTEA) FROM PUBLIC;
COMMENT ON TABLE quota_v2_signed_first_cap_outbox IS
'CI/review-only signed first-genesis spent-byte cap outbox. Immutable replay data is NOT an API permission to start Xray or refund quota. Positive production XSP/2 issuer not attached.';
