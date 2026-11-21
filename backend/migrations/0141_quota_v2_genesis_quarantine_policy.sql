-- Quota V2 FIRST-GENESIS policy handoff. No traffic authority.
-- The ordinary desired-config route permanently marks policy_path_used=TRUE.
-- A first-ever quarantined Xray instead needs a signed desired policy with
-- all legacy offline allowances held at zero, before a separate admission.
--
-- This migration never alters the historical policy_path_used protection,
-- the ordinary node_desired_revisions ledger, or an installed Xray.
CREATE TABLE quota_v2_genesis_quarantine_policies (
  node_id BIGINT PRIMARY KEY REFERENCES quota_v2_xray_genesis(node_id),
  first_activation_sha256 TEXT NOT NULL CHECK(first_activation_sha256 ~ '^[0-9a-f]{64}$'),
  runtime_id TEXT NOT NULL CHECK(runtime_id ~ '^[0-9a-f]{64}$'),
  challenge TEXT NOT NULL CHECK(challenge ~ '^[0-9a-f]{64}$'),
  profile_revision TEXT NOT NULL CHECK(profile_revision ~ '^[0-9a-f]{64}$'),
  policy_sha256 TEXT NOT NULL CHECK(policy_sha256 ~ '^[0-9a-f]{64}$'),
  signed_policy_bytes BYTEA NOT NULL
     CHECK(octet_length(signed_policy_bytes) BETWEEN 200 AND 262144),
  policy_signature TEXT NOT NULL CHECK(policy_signature ~ '^[0-9a-f]{128}$'),
  signer_public_key TEXT NOT NULL CHECK(signer_public_key ~ '^[0-9a-f]{64}$'),
  prepared_ms BIGINT NOT NULL CHECK(prepared_ms>0),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  authorized_bytes BIGINT NOT NULL DEFAULT 0 CHECK(authorized_bytes=0),
  can_start BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT can_start),
  can_resume BOOLEAN NOT NULL DEFAULT FALSE CHECK(NOT can_resume),
  refundable_bytes BIGINT NOT NULL DEFAULT 0 CHECK(refundable_bytes=0)
);
CREATE TRIGGER quota_v2_quarantine_policy_immutable
 BEFORE UPDATE OR DELETE ON quota_v2_genesis_quarantine_policies
 FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();
CREATE TRIGGER quota_v2_quarantine_policy_no_truncate
 BEFORE TRUNCATE ON quota_v2_genesis_quarantine_policies
 FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE FUNCTION quota_v2_stage_genesis_quarantine_policy(
 p_node BIGINT, p_activation TEXT, p_runtime TEXT, p_challenge TEXT,
 p_revision TEXT, p_bytes BYTEA, p_signature TEXT, p_signer TEXT
) RETURNS quota_v2_genesis_quarantine_policies LANGUAGE plpgsql AS $$
DECLARE
  genesis quota_v2_xray_genesis;
  stored quota_v2_genesis_quarantine_policies;
  parsed JSONB;
  active_receipt TEXT;
  now_ms BIGINT;
  history_exists BOOLEAN;
BEGIN
  IF p_node IS NULL OR p_node<=0 OR p_activation IS NULL
     OR p_activation !~ '^[0-9a-f]{64}$'
     OR p_runtime IS NULL OR p_runtime !~ '^[0-9a-f]{64}$'
     OR p_challenge IS NULL OR p_challenge !~ '^[0-9a-f]{64}$'
     OR p_revision IS NULL OR p_revision !~ '^[0-9a-f]{64}$'
     OR p_signature IS NULL OR p_signature !~ '^[0-9a-f]{128}$'
     OR p_signer IS NULL OR p_signer !~ '^[0-9a-f]{64}$'
     OR p_bytes IS NULL OR octet_length(p_bytes) NOT BETWEEN 200 AND 262144 THEN
    RAISE EXCEPTION 'invalid zero-authority genesis quarantine policy'
      USING ERRCODE='22023';
  END IF;
  PERFORM set_config('synchronous_commit','on',true);
  -- Lock the product activation before the immutable Genesis row, matching
  -- activation/preparation order. No Node JSON field supplies this identity.
  SELECT encode(receipt_sha256,'hex') INTO active_receipt
    FROM node_xsp_product_nodes
   WHERE node_id=p_node AND state='active' FOR SHARE;
  SELECT * INTO genesis
    FROM quota_v2_xray_genesis WHERE node_id=p_node FOR UPDATE;
  now_ms:=(EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT;
  IF NOT FOUND OR active_receipt IS DISTINCT FROM p_activation
      OR genesis.node_id IS NULL OR genesis.policy_path_used
      OR genesis.first_activation_sha256 IS DISTINCT FROM p_activation
      OR genesis.runtime_id IS DISTINCT FROM p_runtime
      OR genesis.challenge IS DISTINCT FROM p_challenge
      OR genesis.prepared_ms IS NULL OR genesis.receipt_signature IS NULL
      OR genesis.prepared_ms>now_ms OR now_ms>=genesis.prepared_ms+120000 THEN
    RAISE EXCEPTION 'first-genesis quarantine not prepared or already used'
      USING ERRCODE='22023';
  END IF;
  SELECT
     EXISTS(SELECT 1 FROM node_desired_revisions WHERE node_id=p_node)
     OR EXISTS(SELECT 1 FROM quota_v2_reservations WHERE node_id=p_node)
     OR EXISTS(SELECT 1 FROM quota_v2_external_wal_birth_anchors WHERE node_id=p_node)
     OR EXISTS(SELECT 1 FROM user_node_quota_lifetime WHERE node_id=p_node)
     OR EXISTS(SELECT 1 FROM verified_traffic_deltas WHERE node_id=p_node)
     INTO history_exists;
  IF history_exists THEN
    RAISE EXCEPTION 'existing Xray traffic or policy history cannot be quarantined'
      USING ERRCODE='22023';
  END IF;

  BEGIN
    parsed:=convert_from(p_bytes,'UTF8')::JSONB;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid signed quarantine policy JSON'
      USING ERRCODE='22023';
  END;
  IF jsonb_typeof(parsed)<>'object'
    OR parsed->>'kind'<>'xmesh.quota-v2.genesis-quarantine-policy'
    OR parsed->>'version'<>'1'
    OR parsed->>'nodeId'<>p_node::TEXT
    OR parsed->>'configSha256'<>p_revision
    OR parsed->>'issuedAtMs'<>genesis.prepared_ms::TEXT
    OR parsed->>'validUntilMs'<>(genesis.prepared_ms+120000)::TEXT
    OR parsed->'quotaV2Genesis'->>'mode'<>'quarantined'
    OR parsed->'quotaV2Genesis'->>'runtimeId'<>p_runtime
    OR parsed->'quotaV2Genesis'->>'challenge'<>p_challenge
    OR parsed->'quotaV2Genesis'->>'firstActivationReceiptSha256'<>p_activation
    OR parsed->'quotaV2Genesis'->>'authorizedBytes'<>'0'
    OR parsed->'quotaV2Genesis'->>'canStart'<>'false'
    OR parsed->'quotaV2Genesis'->>'canResume'<>'false'
    OR parsed->'quotaV2Genesis'->>'refundableBytes'<>'0'
    OR jsonb_typeof(parsed->'users')<>'array'
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(
                 COALESCE(parsed->'users','[]'::jsonb)) AS u
           WHERE u->>'offlineBudgetBytes' IS DISTINCT FROM '0'
              OR u->>'onHold' IS DISTINCT FROM 'true')
  THEN
    RAISE EXCEPTION 'quarantine would authorize legacy traffic'
      USING ERRCODE='22023';
  END IF;

  -- Exactly one immutable signed policy per never-used Node/Genesis.
  SELECT * INTO stored FROM quota_v2_genesis_quarantine_policies
    WHERE node_id=p_node;
  IF FOUND THEN
    IF stored.runtime_id IS DISTINCT FROM p_runtime
      OR stored.challenge IS DISTINCT FROM p_challenge
      OR stored.first_activation_sha256 IS DISTINCT FROM p_activation
      OR stored.profile_revision IS DISTINCT FROM p_revision
      OR stored.signed_policy_bytes IS DISTINCT FROM p_bytes
      OR stored.policy_signature IS DISTINCT FROM p_signature
      OR stored.signer_public_key IS DISTINCT FROM p_signer
    THEN
      RAISE EXCEPTION 'conflicting signed first-genesis policy replay'
        USING ERRCODE='22023';
    END IF;
    RETURN stored;
  END IF;
  INSERT INTO quota_v2_genesis_quarantine_policies(
    node_id,first_activation_sha256,runtime_id,challenge,
    profile_revision,policy_sha256,signed_policy_bytes,policy_signature,
    signer_public_key,prepared_ms
  ) VALUES(
    p_node,p_activation,p_runtime,p_challenge,p_revision,
    encode(sha256(p_bytes),'hex'),p_bytes,p_signature,
    p_signer,genesis.prepared_ms
  ) RETURNING * INTO stored;
  RETURN stored;
END;
$$;
REVOKE ALL ON TABLE quota_v2_genesis_quarantine_policies FROM PUBLIC;
REVOKE ALL ON FUNCTION quota_v2_stage_genesis_quarantine_policy(
 BIGINT,TEXT,TEXT,TEXT,TEXT,BYTEA,TEXT,TEXT) FROM PUBLIC;
COMMENT ON TABLE quota_v2_genesis_quarantine_policies IS
'Immutable, signed, zero-spend first-genesis quarantine policy, never a grant. Ordinary desired-config permanently closes genesis eligibility. Stored policy is not proof of installed Xray or complete WAL.';
