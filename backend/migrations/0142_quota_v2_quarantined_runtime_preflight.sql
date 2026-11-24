-- First-ever Quota V2 runtime preflight with a genuinely staged, immutable
-- signed quarantined policy. This function still grants ZERO traffic bytes.
-- It is the ONLY intended staging entrypoint after 0141 policy handoff.
-- Retain the historical 0138 test API for existing audits; a future
-- production issuer MUST use this strict wrapper or stronger verification.
CREATE FUNCTION quota_v2_record_quarantined_runtime_preflight(
    p_user BIGINT, p_epoch UUID, p_node BIGINT, p_meter UUID, p_reservation UUID,
    p_revision BIGINT, p_challenge TEXT, p_runtime TEXT, p_container TEXT,
    p_pid BIGINT, p_policy_sha TEXT, p_activation TEXT, p_wal_floor BIGINT
) RETURNS quota_v2_runtime_admission_preflights LANGUAGE plpgsql AS $$
DECLARE
  signed_policy quota_v2_genesis_quarantine_policies;
  original_policy JSONB;
  snapshot quota_v2_runtime_admission_preflights;
  closed BOOLEAN;
BEGIN
  -- Staged policy is original, immutable and bound to the exact
  -- independently authenticated one-shot Node activation and runtime.
  -- Not an Xray kernel/process attestation or a positive spending grant.
  SELECT * INTO signed_policy FROM quota_v2_genesis_quarantine_policies
    WHERE node_id=p_node FOR SHARE;
  IF NOT FOUND
     OR signed_policy.runtime_id IS DISTINCT FROM p_runtime
     OR signed_policy.first_activation_sha256 IS DISTINCT FROM p_activation
     OR signed_policy.policy_sha256 IS DISTINCT FROM p_policy_sha
     OR signed_policy.authorized_bytes<>0
     OR signed_policy.can_start
     OR signed_policy.can_resume
     OR signed_policy.refundable_bytes<>0 THEN
    RAISE EXCEPTION 'no matching signed quarantined Genesis policy'
      USING ERRCODE='22023';
  END IF;
  original_policy:=convert_from(signed_policy.signed_policy_bytes,'UTF8')::JSONB;
  IF jsonb_typeof(original_policy->'users') IS DISTINCT FROM 'array'
     OR NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(original_policy->'users') AS u
         WHERE u->>'userId' IS NOT DISTINCT FROM p_user::TEXT
           AND u->>'offlineBudgetBytes' IS NOT DISTINCT FROM '0'
           AND u->>'onHold' IS NOT DISTINCT FROM 'true'
     ) THEN
    RAISE EXCEPTION 'user absent from original signed quarantined policy'
      USING ERRCODE='22023';
  END IF;
  -- The real 0138 allocator & SQL preflight retains serial account-first /
  -- lease-second locking, active epoch, no revocation/old debt, expiry and
  -- global budget conservation. This wrapper never bypasses those checks.
  SELECT * INTO STRICT snapshot FROM quota_v2_record_runtime_admission_preflight(
    p_user,p_epoch,p_node,p_meter,p_reservation,p_revision,p_challenge,
    p_runtime,p_container,p_pid,p_policy_sha,p_activation,p_wal_floor
  );
  -- The original 0138 function locked account -> lease -> Genesis in that
  -- order. Now that the transaction holds those locks, reject an ordinary
  -- desired-config policy which permanently consumed first-Genesis. A
  -- rejection rolls back the snapshot insert in the SAME transaction.
  SELECT policy_path_used INTO STRICT closed
    FROM quota_v2_xray_genesis WHERE node_id=p_node FOR SHARE;
  IF closed THEN
    RAISE EXCEPTION 'ordinary desired-config already consumed Genesis'
      USING ERRCODE='22023';
  END IF;
  RETURN snapshot;
END;
$$;
REVOKE ALL ON FUNCTION quota_v2_record_quarantined_runtime_preflight(
 BIGINT,UUID,BIGINT,UUID,UUID,BIGINT,TEXT,TEXT,TEXT,
 BIGINT,TEXT,TEXT,BIGINT) FROM PUBLIC;
COMMENT ON FUNCTION quota_v2_record_quarantined_runtime_preflight(
 BIGINT,UUID,BIGINT,UUID,UUID,BIGINT,TEXT,TEXT,TEXT,
 BIGINT,TEXT,TEXT,BIGINT) IS
'No authority: strictly binds staged signed zero-spend user policy to one existing SQL reservation and immutable first-genesis runtime. Not an issuer or evidence of kernel attestation.';
