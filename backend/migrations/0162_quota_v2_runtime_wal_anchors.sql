-- Fresh Xray processes have their own sequence space. Keep the original
-- Node-wide ledger readable and immutable for first-genesis reservations.
CREATE TABLE quota_v2_runtime_wal_anchors (
    node_id BIGINT NOT NULL CHECK (node_id>0),
    runtime_id TEXT NOT NULL CHECK (runtime_id ~ '^[0-9a-f]{64}$'),
    inventory_sequence INT NOT NULL CHECK (inventory_sequence BETWEEN 1 AND 4096),
    inventory_sha256 TEXT NOT NULL CHECK (inventory_sha256 ~ '^[0-9a-f]{64}$'),
    inventory_tail_digest TEXT NOT NULL CHECK (inventory_tail_digest ~ '^[0-9a-f]{64}$'),
    original_node_witness_sha256 TEXT NOT NULL CHECK (original_node_witness_sha256 ~ '^[0-9a-f]{64}$'),
    old_container_id TEXT NOT NULL CHECK (old_container_id ~ '^[0-9a-f]{64}$'),
    old_started_at TEXT NOT NULL CHECK (length(old_started_at) BETWEEN 15 AND 64),
    inventory_bytes BYTEA NOT NULL CHECK (octet_length(inventory_bytes) BETWEEN 1 AND 4194304),
    first_external_witness BOOLEAN NOT NULL,
    witness_bytes BYTEA NOT NULL CHECK (octet_length(witness_bytes) BETWEEN 1 AND 4096),
    PRIMARY KEY (node_id,runtime_id,inventory_sequence)
);

CREATE TRIGGER quota_v2_runtime_wal_immutable
BEFORE UPDATE OR DELETE ON quota_v2_runtime_wal_anchors
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE TRIGGER quota_v2_runtime_wal_no_truncate
BEFORE TRUNCATE ON quota_v2_runtime_wal_anchors
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE FUNCTION quota_v2_store_runtime_wal_anchor(
    p_node BIGINT,p_runtime TEXT,p_sequence INT,p_sha TEXT,p_tail TEXT,
    p_witness_sha TEXT,p_container TEXT,p_started TEXT,p_inventory BYTEA,p_witness BYTEA
) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
    prior quota_v2_runtime_wal_anchors;
    first_anchor BOOLEAN;
    source TEXT;
BEGIN
    IF encode(sha256(p_inventory),'hex') IS DISTINCT FROM p_sha
       OR encode(sha256(p_witness),'hex') IS DISTINCT FROM p_witness_sha THEN
        RAISE EXCEPTION 'runtime WAL bytes differ from their digests' USING ERRCODE='22023';
    END IF;
    source := convert_from(p_inventory,'UTF8');
    IF right(source,1) IS DISTINCT FROM E'\n'
       OR length(source)-length(replace(source,E'\n','')) IS DISTINCT FROM p_sequence THEN
        RAISE EXCEPTION 'runtime WAL sequence count differs' USING ERRCODE='22023';
    END IF;
    PERFORM pg_advisory_xact_lock(1794502,hashtext(p_node::text||':'||p_runtime));
    SELECT * INTO prior FROM quota_v2_runtime_wal_anchors
      WHERE node_id=p_node AND runtime_id=p_runtime ORDER BY inventory_sequence DESC LIMIT 1;
    first_anchor := NOT FOUND;
    IF NOT first_anchor THEN
        IF prior.old_container_id IS DISTINCT FROM p_container
           OR prior.old_started_at IS DISTINCT FROM p_started
           OR p_sequence<prior.inventory_sequence THEN
            RAISE EXCEPTION 'runtime WAL identity or sequence regressed' USING ERRCODE='22023';
        END IF;
        IF p_sequence=prior.inventory_sequence THEN
            IF prior.inventory_bytes IS DISTINCT FROM p_inventory
               OR prior.witness_bytes IS DISTINCT FROM p_witness
               OR prior.inventory_tail_digest IS DISTINCT FROM p_tail THEN
                RAISE EXCEPTION 'runtime WAL checkpoint replay differs' USING ERRCODE='22023';
            END IF;
            RETURN prior.first_external_witness;
        END IF;
        IF octet_length(p_inventory)<=octet_length(prior.inventory_bytes)
           OR substring(p_inventory FROM 1 FOR octet_length(prior.inventory_bytes))
               IS DISTINCT FROM prior.inventory_bytes THEN
            RAISE EXCEPTION 'runtime WAL checkpoint lost its original prefix' USING ERRCODE='22023';
        END IF;
    END IF;
    INSERT INTO quota_v2_runtime_wal_anchors VALUES (
        p_node,p_runtime,p_sequence,p_sha,p_tail,p_witness_sha,p_container,p_started,
        p_inventory,first_anchor,p_witness
    );
    RETURN first_anchor;
END;
$$;

REVOKE ALL ON quota_v2_runtime_wal_anchors FROM PUBLIC;
REVOKE ALL ON FUNCTION quota_v2_store_runtime_wal_anchor(
    BIGINT,TEXT,INT,TEXT,TEXT,TEXT,TEXT,TEXT,BYTEA,BYTEA
) FROM PUBLIC;

-- The first Genesis and later signed admissions are both valid historical
-- predecessors. Their immutable tables continue to own the exact envelopes.
CREATE VIEW quota_v2_wal_admission_caps AS
    SELECT reservation_id,node_id,user_id,epoch,meter_epoch,runtime_id,
           policy_sha256,signer_public_key,valid_until_ms,signed_envelope,false AS successor
      FROM quota_v2_signed_first_cap_outbox
    UNION ALL
    SELECT reservation_id,node_id,user_id,account_epoch,meter_epoch,fresh_runtime_id,
           policy_sha256,signer_public_key,valid_until_ms,signed_envelope,true
      FROM quota_v2_calendar_successor_positive_caps;

REVOKE ALL ON quota_v2_wal_admission_caps FROM PUBLIC;
