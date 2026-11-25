-- Quota V2 public TLS PRE-ISSUANCE CANDIDATES (read-only, zero authority).
--
-- This is not a signed public listener, a quota grant, or proof of an
-- installed Xray. A future issuer must authenticate strict XSP/2, prove the
-- actual host PID/runtime and complete WAL inventory, verify certificate
-- ownership and node enablement, lock/serialize revocation with issuance,
-- and supervise expiry/revocation continuously. This function is only a
-- fail-closed SQL *filter* over already committed first-Genesis evidence.
-- It must NEVER be called as a direct "open TLS port" authorization.
--
-- Later successor generations have different WAL/predecessor evidence.
-- Fail closed for those generations until independently reviewed.
CREATE FUNCTION quota_v2_public_tls_first_cap_candidates(
    p_node BIGINT, p_activation TEXT, p_runtime TEXT, p_profile TEXT,
    p_genesis_policy TEXT, p_signer TEXT, p_required_lifetime_ms BIGINT
)
RETURNS TABLE (
    user_id BIGINT,
    account_epoch UUID,
    reservation_id UUID,
    meter_epoch UUID,
    reservation_revision BIGINT,
    valid_until_ms BIGINT,
    remaining_signed_bytes BIGINT
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    now_ms BIGINT;
BEGIN
    IF p_node IS NULL OR p_node<=0
       OR p_activation IS NULL OR p_activation !~ '^[0-9a-f]{64}$'
       OR p_runtime IS NULL OR p_runtime !~ '^[0-9a-f]{64}$'
       OR p_profile IS NULL OR p_profile !~ '^[0-9a-f]{64}$'
       OR p_genesis_policy IS NULL OR p_genesis_policy !~ '^[0-9a-f]{64}$'
       OR p_signer IS NULL OR p_signer !~ '^[0-9a-f]{64}$'
       OR p_required_lifetime_ms IS NULL OR
          p_required_lifetime_ms NOT BETWEEN 1000 AND 120000 THEN
       RAISE EXCEPTION 'invalid public TLS first-cap candidate identity'
         USING ERRCODE='22023';
    END IF;

    now_ms := (EXTRACT(EPOCH FROM clock_timestamp())*1000)::BIGINT;
    RETURN QUERY
    SELECT
        o.user_id, o.epoch, o.reservation_id, o.meter_epoch, o.revision,
        o.valid_until_ms,
        (o.grant_bytes-GREATEST(r.acknowledged_bytes,
            r.conservative_burn_floor_bytes))::BIGINT
    FROM quota_v2_signed_first_cap_outbox o
    JOIN quota_v2_runtime_admission_preflights pf
      ON pf.node_id=o.node_id AND pf.request_challenge=o.request_challenge
      AND pf.user_id=o.user_id AND pf.epoch=o.epoch
      AND pf.meter_epoch=o.meter_epoch AND pf.reservation_id=o.reservation_id
    JOIN quota_v2_genesis_quarantine_policies q ON q.node_id=o.node_id
    JOIN quota_v2_xray_genesis g ON g.node_id=o.node_id
    JOIN node_xsp_product_nodes n ON n.node_id=o.node_id
    JOIN quota_v2_reservations r
      ON r.node_id=o.node_id AND r.user_id=o.user_id
      AND r.epoch=o.epoch AND r.meter_epoch=o.meter_epoch
      AND r.reservation_id=o.reservation_id
    JOIN quota_v2_accounts a ON a.user_id=o.user_id AND a.epoch=o.epoch
    WHERE o.node_id=p_node
      AND o.runtime_id=p_runtime AND pf.prepared_runtime_id=p_runtime
      AND g.runtime_id=p_runtime AND q.runtime_id=p_runtime
      AND q.profile_revision=p_profile
      -- Even a legacy 0138 preflight or an owner-inserted outbox row must
      -- never turn an unlisted user into a valid first-Genesis candidate.
      AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(
              (convert_from(q.signed_policy_bytes,'UTF8')::JSONB)->'users'
          ) AS listed
          WHERE listed->>'userId'=o.user_id::TEXT
            AND listed->>'offlineBudgetBytes'='0'
            AND listed->>'onHold'='true'
      )
      AND o.policy_sha256=p_genesis_policy AND q.policy_sha256=p_genesis_policy
      AND pf.reported_policy_sha256=p_genesis_policy
      AND o.signer_public_key=p_signer AND q.signer_public_key=p_signer
      AND pf.first_activation_sha256=p_activation
      AND q.first_activation_sha256=p_activation
      AND g.first_activation_sha256=p_activation
      AND n.state='active' AND encode(n.receipt_sha256,'hex')=p_activation
      AND NOT g.policy_path_used
      AND NOT a.closed AND a.limit_bytes>0
      AND r.node_confirmed AND r.revision=o.revision
      AND r.ceiling_bytes=o.grant_bytes
      AND r.conservative_burned_at IS NULL
      AND GREATEST(r.acknowledged_bytes,r.conservative_burn_floor_bytes)
          < o.grant_bytes
      AND o.valid_until_ms>now_ms+p_required_lifetime_ms
      AND (EXTRACT(EPOCH FROM r.valid_until)*1000)::BIGINT
          >now_ms+p_required_lifetime_ms
      AND (EXTRACT(EPOCH FROM pf.expires_at)*1000)::BIGINT
          >now_ms+p_required_lifetime_ms
      AND EXISTS (SELECT 1
          FROM quota_v2_genesis_lease_replies prep
          JOIN quota_v2_genesis_lease_replies conf
            ON conf.node_id=prep.node_id AND conf.user_id=prep.user_id
          WHERE prep.node_id=o.node_id AND prep.user_id=o.user_id
            AND prep.stage='prepare' AND conf.stage='confirm'
            AND prep.policy_sha256=p_genesis_policy
            AND conf.policy_sha256=p_genesis_policy
            AND prep.signer_public_key=p_signer
            AND conf.signer_public_key=p_signer)
      AND NOT EXISTS (SELECT 1 FROM quota_v2_revocation_requests v
         WHERE v.user_id=r.user_id AND v.epoch=r.epoch
           AND v.node_id=r.node_id AND v.meter_epoch=r.meter_epoch
           AND v.reservation_id=r.reservation_id)
      AND NOT EXISTS (SELECT 1 FROM quota_v2_accounts old
         JOIN quota_v2_reservations old_r
           ON old_r.user_id=old.user_id AND old_r.epoch=old.epoch
         WHERE old.user_id=o.user_id AND old.closed
           AND old_r.ceiling_bytes >
             GREATEST(old_r.acknowledged_bytes,
                      old_r.conservative_burn_floor_bytes))
      AND (SELECT GREATEST(a.settled_bytes,a.observed_floor_bytes)::NUMERIC
                  + COALESCE(SUM(
                     (rr.ceiling_bytes-GREATEST(rr.acknowledged_bytes,
                             rr.conservative_burn_floor_bytes))::NUMERIC),0)
             FROM quota_v2_reservations rr
            WHERE rr.user_id=a.user_id AND rr.epoch=a.epoch)
          <= a.limit_bytes::NUMERIC
    ORDER BY o.user_id;
END;
$$;

-- Read-path is intentionally unavailable to arbitrary SQL callers. It
-- neither mutates state nor creates any new positive signed authority.
REVOKE ALL ON FUNCTION quota_v2_public_tls_first_cap_candidates(
    BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT
) FROM PUBLIC;
COMMENT ON FUNCTION quota_v2_public_tls_first_cap_candidates(
    BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT
) IS 'Read-only, non-authorizing candidate filter. Does not attest live Xray, install cap, verify TLS, sign or open a listener.';
