-- SERIALIZED first-Genesis public TLS SQL eligibility gate (NO traffic authority).
--
-- A future production positive TLS issuer must call this function inside its
-- OWN PostgreSQL READ COMMITTED transaction, verify the genuine enrolled Node,
-- current root-owned Xray PID/certificate/WAL, build+sign the short-lived
-- authority while STILL HOLDING the locks, and only then commit the outbox.
-- This function NEVER signs a TLS policy, starts ingress, grants/refunds bytes
-- or marks the Node live. It makes the mutable first-Genesis SQL portion
-- serializable with current account/lease revocation writers.
--
-- Lock order:
--   enrolled Node activation FOR SHARE
--   ALL original signed-grant accounts, increasing (user_id, epoch)
--   ALL original signed-grant leases, increasing (user_id, epoch, meter_epoch)
--   Genesis runtime FOR SHARE
-- This preserves the account -> reservation -> genesis order of 0139's
-- signed-cap outbox. A Node revoke must wait on the enrolled Node lock.
-- The only recognized first-Genesis caps are those in immutable 0139.
-- Any foreign/out-of-generation first cap poisons the entire TLS roster.
CREATE FUNCTION quota_v2_public_tls_lock_exact_first_roster(
    p_node BIGINT, p_activation TEXT, p_runtime TEXT, p_profile TEXT,
    p_genesis_policy TEXT, p_signer TEXT, p_required_lifetime_ms BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
    enrolled_receipt TEXT;
    original quota_v2_genesis_quarantine_policies;
    genesis quota_v2_xray_genesis;
    grant_row quota_v2_signed_first_cap_outbox;
    original_count INTEGER;
    grant_count BIGINT;
    matching BOOLEAN;
    locked_account BIGINT;
    locked_lease UUID;
BEGIN
    IF p_node IS NULL OR p_node<=0
       OR p_activation IS NULL OR p_activation !~ '^[0-9a-f]{64}$'
       OR p_runtime IS NULL OR p_runtime !~ '^[0-9a-f]{64}$'
       OR p_profile IS NULL OR p_profile !~ '^[0-9a-f]{64}$'
       OR p_genesis_policy IS NULL OR p_genesis_policy !~ '^[0-9a-f]{64}$'
       OR p_signer IS NULL OR p_signer !~ '^[0-9a-f]{64}$'
       OR p_required_lifetime_ms IS NULL
       OR p_required_lifetime_ms NOT BETWEEN 1000 AND 120000 THEN
        RAISE EXCEPTION 'invalid serialized first-genesis TLS identity'
            USING ERRCODE='22023';
    END IF;

    -- Exclusive Node lifecycle updates (revocation/re-enrollment) must not
    -- pass between this check and a future signed issuer's durable commit.
    SELECT encode(n.receipt_sha256,'hex') INTO enrolled_receipt
      FROM node_xsp_product_nodes n
     WHERE n.node_id=p_node AND n.state='active'
     FOR SHARE;
    IF enrolled_receipt IS DISTINCT FROM p_activation THEN
        RETURN FALSE;
    END IF;
    SELECT * INTO original
      FROM quota_v2_genesis_quarantine_policies
     WHERE node_id=p_node AND first_activation_sha256=p_activation
       AND runtime_id=p_runtime AND profile_revision=p_profile
       AND policy_sha256=p_genesis_policy AND signer_public_key=p_signer;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    -- Validation is tightened again by 0168 after all locks are acquired.
    SELECT CASE WHEN jsonb_typeof(
         (convert_from(original.signed_policy_bytes,'UTF8')::JSONB)->'users'
       )='array'
       THEN jsonb_array_length(
         (convert_from(original.signed_policy_bytes,'UTF8')::JSONB)->'users')
       ELSE 0 END INTO original_count;
    IF original_count NOT BETWEEN 1 AND 2048 THEN
        RETURN FALSE;
    END IF;

    SELECT COUNT(*) INTO grant_count
      FROM quota_v2_signed_first_cap_outbox WHERE node_id=p_node;
    IF grant_count<>original_count THEN
        RETURN FALSE;
    END IF;

    -- Account-first locking: never select user IDs from caller input.
    -- The signed, immutable original outbox is the ONLY lock roster.
    FOR grant_row IN
        SELECT * FROM quota_v2_signed_first_cap_outbox
         WHERE node_id=p_node ORDER BY user_id,epoch,meter_epoch
    LOOP
        IF grant_row.runtime_id IS DISTINCT FROM p_runtime
           OR grant_row.policy_sha256 IS DISTINCT FROM p_genesis_policy
           OR grant_row.signer_public_key IS DISTINCT FROM p_signer THEN
            RETURN FALSE;
        END IF;
        SELECT a.user_id INTO locked_account FROM quota_v2_accounts a
         WHERE a.user_id=grant_row.user_id AND a.epoch=grant_row.epoch
         FOR UPDATE;
        IF NOT FOUND THEN
            RETURN FALSE;
        END IF;
    END LOOP;

    -- Never reverse this lock order. Owner revocation, quota grants and
    -- conservative burning all acquire account before reservation locks.
    FOR grant_row IN
        SELECT * FROM quota_v2_signed_first_cap_outbox
         WHERE node_id=p_node ORDER BY user_id,epoch,meter_epoch
    LOOP
        SELECT r.reservation_id INTO locked_lease FROM quota_v2_reservations r
         WHERE r.user_id=grant_row.user_id AND r.epoch=grant_row.epoch
           AND r.node_id=grant_row.node_id
           AND r.meter_epoch=grant_row.meter_epoch
           AND r.reservation_id=grant_row.reservation_id
         FOR UPDATE;
        IF locked_lease IS DISTINCT FROM grant_row.reservation_id THEN
            RETURN FALSE;
        END IF;
    END LOOP;

    SELECT * INTO genesis FROM quota_v2_xray_genesis
     WHERE node_id=p_node FOR SHARE;
    IF NOT FOUND OR genesis.runtime_id IS DISTINCT FROM p_runtime
       OR genesis.first_activation_sha256 IS DISTINCT FROM p_activation
       OR genesis.policy_path_used THEN
        RETURN FALSE;
    END IF;

    -- This checks ALL users, epochs, signed first caps, pending revocations,
    -- closed accounts, changed lease revisions, held budget and TTL only
    -- after locking every involved writer. The locks persist until the
    -- caller commits; the boolean by itself remains NON-AUTHORIZING.
    SELECT quota_v2_public_tls_exact_first_roster(
        p_node,p_activation,p_runtime,p_profile,p_genesis_policy,
        p_signer,p_required_lifetime_ms
    ) INTO matching;
    RETURN COALESCE(matching,FALSE);
END;
$$;

REVOKE ALL ON FUNCTION quota_v2_public_tls_lock_exact_first_roster(
    BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT
) FROM PUBLIC;
COMMENT ON FUNCTION quota_v2_public_tls_lock_exact_first_roster(
    BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT
) IS 'Non-authorizing SQL serialization gate for a future TLS issuer. Caller must retain all row locks until its signed outbox transaction commits. Never permission to serve traffic.';

-- Revocation can be written by legacy SQL helpers as well as HTTP handlers.
-- Locking only the issuer is insufficient if even one writer bypasses the
-- account -> lease lock order. Enforce it at the database boundary for EVERY
-- new revocation intent (including direct INSERT and ON CONFLICT paths).
-- The intent itself remains forever a stop signal; DELETE and TRUNCATE are
-- forbidden, while the existing applied_at / signed-stop columns may update.
CREATE FUNCTION quota_v2_revocation_intent_serialization_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
    account_owner BIGINT;
    current_reservation UUID;
BEGIN
    SELECT a.user_id INTO account_owner FROM quota_v2_accounts a
     WHERE a.user_id=NEW.user_id AND a.epoch=NEW.epoch FOR UPDATE;
    IF account_owner IS DISTINCT FROM NEW.user_id THEN
        RAISE EXCEPTION 'revocation must bind an existing account'
          USING ERRCODE='22023';
    END IF;
    SELECT r.reservation_id INTO current_reservation FROM quota_v2_reservations r
     WHERE r.user_id=NEW.user_id AND r.epoch=NEW.epoch
       AND r.node_id=NEW.node_id AND r.meter_epoch=NEW.meter_epoch
     FOR UPDATE;
    IF current_reservation IS DISTINCT FROM NEW.reservation_id THEN
        RAISE EXCEPTION 'revocation must bind the currently locked reservation'
          USING ERRCODE='22023';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER quota_v2_revocation_intent_serialized
BEFORE INSERT ON quota_v2_revocation_requests
FOR EACH ROW EXECUTE FUNCTION quota_v2_revocation_intent_serialization_guard();
-- The accepted intent's immutable identity may never be relabelled into
-- another reservation after a signed cap was issued. Preserve the existing
-- legitimate applied_at / applied_revision / used-byte updates.
CREATE FUNCTION quota_v2_revocation_intent_identity_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $
BEGIN
    IF ROW(NEW.user_id,NEW.epoch,NEW.node_id,NEW.meter_epoch,
           NEW.reservation_id,NEW.request_id,NEW.requested_at)
       IS DISTINCT FROM
       ROW(OLD.user_id,OLD.epoch,OLD.node_id,OLD.meter_epoch,
           OLD.reservation_id,OLD.request_id,OLD.requested_at) THEN
        RAISE EXCEPTION 'revocation lease, request and timestamp cannot be relabelled'
            USING ERRCODE='22023';
    END IF;
    RETURN NEW;
END;
$;
CREATE TRIGGER quota_v2_revocation_intent_identity_immutable
BEFORE UPDATE ON quota_v2_revocation_requests
FOR EACH ROW EXECUTE FUNCTION quota_v2_revocation_intent_identity_immutable();
REVOKE ALL ON FUNCTION quota_v2_revocation_intent_identity_immutable() FROM PUBLIC;
CREATE TRIGGER quota_v2_revocation_intent_no_delete
BEFORE DELETE ON quota_v2_revocation_requests
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();
CREATE TRIGGER quota_v2_revocation_intent_no_truncate
BEFORE TRUNCATE ON quota_v2_revocation_requests
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();
REVOKE ALL ON FUNCTION quota_v2_revocation_intent_serialization_guard() FROM PUBLIC;
COMMENT ON FUNCTION quota_v2_revocation_intent_serialization_guard()
IS 'Every new immutable revocation intent must lock account then exact lease; serializes with a pending public TLS issuer transaction.';
