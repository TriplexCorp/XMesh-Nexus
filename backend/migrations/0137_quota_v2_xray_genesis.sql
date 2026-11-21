-- A staging Node is eligible only if its original creation transaction
-- explicitly recorded it. Never infer eligibility or backfill an old Node.
-- Keep rows after Node deletion or re-enrollment. Genesis does not grant
-- traffic, mutate a reservation, or settle any historical bytes.
CREATE TABLE quota_v2_xray_genesis (
    node_id BIGINT PRIMARY KEY CHECK (node_id > 0),
    first_activation_sha256 TEXT CHECK (first_activation_sha256 ~ '^[0-9a-f]{64}$'),
    runtime_id TEXT CHECK (runtime_id ~ '^[0-9a-f]{64}$'),
    challenge TEXT CHECK (challenge ~ '^[0-9a-f]{64}$'),
    prepared_ms BIGINT CHECK (prepared_ms > 0),
    receipt_signature TEXT CHECK (receipt_signature ~ '^[0-9a-f]{128}$'),
    policy_path_used BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (num_nonnulls(runtime_id,challenge,prepared_ms,receipt_signature) IN (0,4)),
    CHECK (runtime_id IS NULL OR first_activation_sha256 IS NOT NULL)
);

CREATE FUNCTION quota_v2_protect_xray_genesis() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RAISE EXCEPTION 'Xray genesis evidence cannot be removed' USING ERRCODE='22023';
    END IF;
    IF NEW.node_id IS DISTINCT FROM OLD.node_id
        OR (OLD.first_activation_sha256 IS NOT NULL AND
            NEW.first_activation_sha256 IS DISTINCT FROM OLD.first_activation_sha256)
        OR (OLD.policy_path_used AND NOT NEW.policy_path_used)
        OR (OLD.runtime_id IS NOT NULL AND
            ROW(NEW.runtime_id,NEW.challenge,NEW.prepared_ms,NEW.receipt_signature)
            IS DISTINCT FROM
            ROW(OLD.runtime_id,OLD.challenge,OLD.prepared_ms,OLD.receipt_signature))
        OR (NEW.runtime_id IS NOT NULL AND OLD.runtime_id IS NULL AND NEW.policy_path_used)
    THEN
        RAISE EXCEPTION 'Xray genesis evidence cannot be reassigned' USING ERRCODE='22023';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER quota_v2_protect_xray_genesis_row
    BEFORE UPDATE OR DELETE ON quota_v2_xray_genesis
    FOR EACH ROW EXECUTE FUNCTION quota_v2_protect_xray_genesis();
CREATE TRIGGER quota_v2_protect_xray_genesis_truncate
    BEFORE TRUNCATE ON quota_v2_xray_genesis
    FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_protect_xray_genesis();

-- Bind the marker in the first strict activation commit. Later key
-- enrollments, revocation and reactivation cannot recreate that binding.
CREATE FUNCTION quota_v2_bind_xray_genesis_activation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE quota_v2_xray_genesis
       SET first_activation_sha256=encode(NEW.receipt_sha256,'hex')
     WHERE node_id=NEW.node_id AND first_activation_sha256 IS NULL;
    RETURN NEW;
END;
$$;
CREATE TRIGGER quota_v2_bind_xray_genesis_activation_trg
    AFTER UPDATE OF state ON node_xsp_product_nodes
    FOR EACH ROW WHEN (OLD.state <> 'active' AND NEW.state = 'active')
    EXECUTE FUNCTION quota_v2_bind_xray_genesis_activation();
