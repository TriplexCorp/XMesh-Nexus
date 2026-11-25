-- Read-only exact FIRST-GENESIS public TLS roster diagnostic.
--
-- This gate is deliberately NOT an authorization, cap renewal, ingress
-- ticket, or substitute for verified on-host Xray state / durable WAL.
-- A future positive issuer MUST serialize with revocation and lease writes,
-- attest the installed metering process and verify the authenticated Node.
-- One eligible user is not enough to expose a shared VLESS TLS listener:
-- EVERY signed Genesis client must own an unexpired confirmed cap, with no
-- additional eligible clients or duplicate roster identities.
CREATE FUNCTION quota_v2_public_tls_exact_first_roster(
    p_node BIGINT, p_activation TEXT, p_runtime TEXT, p_profile TEXT,
    p_genesis_policy TEXT, p_signer TEXT, p_required_lifetime_ms BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    roster JSONB;
    complete BOOLEAN;
BEGIN
    -- This read-path deliberately does NOT accept caller-provided user IDs.
    -- Only the immutable original Genesis roster can define expected users.
    SELECT (convert_from(q.signed_policy_bytes, 'UTF8')::JSONB)->'users'
      INTO roster
      FROM quota_v2_genesis_quarantine_policies q
     WHERE q.node_id=p_node
       AND q.first_activation_sha256=p_activation
       AND q.runtime_id=p_runtime
       AND q.profile_revision=p_profile
       AND q.policy_sha256=p_genesis_policy
       AND q.signer_public_key=p_signer;
    IF roster IS NULL OR jsonb_typeof(roster)<>'array'
       OR jsonb_array_length(roster) NOT BETWEEN 1 AND 2048 THEN
        RETURN FALSE;
    END IF;

    -- Treat every malformed or incomplete signed user as a negative result.
    -- The 19-digit bound is tested as NUMERIC before any BIGINT cast below.
    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(roster) AS entry(user_record)
         WHERE jsonb_typeof(entry.user_record) IS DISTINCT FROM 'object'
            OR jsonb_typeof(entry.user_record->'userId') IS DISTINCT FROM 'number'
            OR entry.user_record->>'userId' !~ '^[1-9][0-9]{0,18}$'
            OR CASE WHEN entry.user_record->>'userId' ~ '^[1-9][0-9]{0,18}$'
                    THEN (entry.user_record->>'userId')::NUMERIC > 9223372036854775807
                    ELSE TRUE END
            OR jsonb_typeof(entry.user_record->'offlineBudgetBytes') IS DISTINCT FROM 'number'
            OR entry.user_record->>'offlineBudgetBytes' IS DISTINCT FROM '0'
            OR jsonb_typeof(entry.user_record->'onHold') IS DISTINCT FROM 'boolean'
            OR entry.user_record->>'onHold' IS DISTINCT FROM 'true'
    ) THEN
        RETURN FALSE;
    END IF;

    -- A foreign first-Genesis signed outbox entry must not disappear simply
    -- because migration 0167 correctly excludes it from eligible candidates.
    -- Its bytes might still be present on the real Xray. Refuse the ENTIRE
    -- public socket until the extra grant is independently reconciled.
    IF EXISTS (
        SELECT 1 FROM quota_v2_signed_first_cap_outbox o
         WHERE o.node_id=p_node
           AND o.runtime_id=p_runtime
           AND o.policy_sha256=p_genesis_policy
           AND NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements(roster) AS original(user_record)
                WHERE original.user_record->>'userId'=o.user_id::TEXT
           )
    ) THEN
        RETURN FALSE;
    END IF;

    -- Materialize the current SQL candidate snapshot ONCE. Re-evaluating a
    -- mutable cap/revocation function for each user could mix generations.
    -- This is still only a best-effort read snapshot; no long-lived positive
    -- authorization or lease may be inferred from its return value.
    WITH expected AS MATERIALIZED (
        SELECT (entry.user_record->>'userId')::BIGINT AS user_id
          FROM jsonb_array_elements(roster) AS entry(user_record)
    ),
    eligible AS MATERIALIZED (
        SELECT c.user_id
          FROM quota_v2_public_tls_first_cap_candidates(
            p_node,p_activation,p_runtime,p_profile,p_genesis_policy,
            p_signer,p_required_lifetime_ms
          ) c
    )
    SELECT
        (SELECT COUNT(*) FROM expected)=(SELECT COUNT(*) FROM eligible)
        AND (SELECT COUNT(*) FROM expected)
            =(SELECT COUNT(DISTINCT user_id) FROM expected)
        AND (SELECT COUNT(*) FROM eligible)
            =(SELECT COUNT(DISTINCT user_id) FROM eligible)
        AND NOT EXISTS (
            SELECT user_id FROM expected EXCEPT SELECT user_id FROM eligible
        )
        AND NOT EXISTS (
            SELECT user_id FROM eligible EXCEPT SELECT user_id FROM expected
        )
      INTO complete;
    RETURN COALESCE(complete,FALSE);
END;
$$;

REVOKE ALL ON FUNCTION quota_v2_public_tls_exact_first_roster(
    BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT
) FROM PUBLIC;
COMMENT ON FUNCTION quota_v2_public_tls_exact_first_roster(
    BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT
) IS 'Non-authorizing diagnostic: the exact distinct original Genesis user roster equals the full currently eligible SQL first-cap roster. Never permits public TLS without installed-Xray cap, WAL, certificate and serialized revocation proof.';
