-- Quota V2: externally retained FULL Xray WAL-birth inventory witnesses.
--
-- This is a NONFINAL, NONSPENDABLE forensic registry. It is never a replacement
-- for all-outbound-writer finality, never a quota debit/credit, and never a
-- reason to re-admit an old user. Cryptographic verification happens outside
-- SQL, against an independently enrolled Node public key.
--
-- All raw index bytes live in PostgreSQL (outside Node/Xray disk), so a Node
-- restart that loses BOTH local WALs and their local index cannot hide an
-- earlier remotely witnessed prefix from the independent recovery checker.
CREATE TABLE quota_v2_offhost_birth_witnesses (
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    inventory_sequence INTEGER NOT NULL CHECK (inventory_sequence BETWEEN 1 AND 4096),
    inventory_sha256 TEXT NOT NULL CHECK (inventory_sha256 ~ '^[0-9a-f]{64}$'),
    inventory_tail_digest TEXT NOT NULL CHECK (inventory_tail_digest ~ '^[0-9a-f]{64}$'),
    node_public_key_sha256 TEXT NOT NULL CHECK (node_public_key_sha256 ~ '^[0-9a-f]{64}$'),
    old_container_id TEXT NOT NULL CHECK (old_container_id ~ '^[0-9a-f]{64}$'),
    old_started_at TEXT NOT NULL CHECK (
        length(old_started_at) BETWEEN 15 AND 64 AND position('T' IN old_started_at) > 0),
    full_inventory BYTEA NOT NULL CHECK (
        octet_length(full_inventory) BETWEEN 1 AND 4194304),
    signed_node_witness BYTEA NOT NULL CHECK (
        octet_length(signed_node_witness) BETWEEN 1 AND 4096),
    previous_inventory_sha256 TEXT CHECK (
        previous_inventory_sha256 IS NULL OR
        previous_inventory_sha256 ~ '^[0-9a-f]{64}$'),
    committed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (node_id, inventory_sequence),
    UNIQUE (node_id, inventory_sha256)
);

CREATE FUNCTION quota_v2_offhost_birth_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'offhost WAL birth witness history is immutable'
        USING ERRCODE = '22023';
END;
$$;

CREATE TRIGGER quota_v2_offhost_birth_immutable_rows
BEFORE UPDATE OR DELETE ON quota_v2_offhost_birth_witnesses
FOR EACH ROW EXECUTE FUNCTION quota_v2_offhost_birth_immutable();

CREATE TRIGGER quota_v2_offhost_birth_no_truncate
BEFORE TRUNCATE ON quota_v2_offhost_birth_witnesses
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_offhost_birth_immutable();

-- The only authorized caller is an independently signature-verifying
-- off-host registrar. SQL deliberately does NOT accept caller-provided
-- byte amounts or claims of old PID stop, complete meter, or refund authority.
CREATE FUNCTION quota_v2_register_offhost_birth_witness(
    p_node BIGINT, p_sequence INTEGER, p_sha TEXT, p_tail TEXT,
    p_key_sha TEXT, p_container TEXT, p_started TEXT,
    p_inventory BYTEA, p_witness BYTEA
) RETURNS quota_v2_offhost_birth_witnesses
LANGUAGE plpgsql AS $$
DECLARE
    prior quota_v2_offhost_birth_witnesses;
    same quota_v2_offhost_birth_witnesses;
    saved quota_v2_offhost_birth_witnesses;
BEGIN
    IF p_node IS NULL OR p_node <= 0 OR p_sequence IS NULL OR
       p_sequence NOT BETWEEN 1 AND 4096 OR
       p_sha IS NULL OR p_sha !~ '^[0-9a-f]{64}$' OR
       p_tail IS NULL OR p_tail !~ '^[0-9a-f]{64}$' OR
       p_key_sha IS NULL OR p_key_sha !~ '^[0-9a-f]{64}$' OR
       p_container IS NULL OR p_container !~ '^[0-9a-f]{64}$' OR
       p_started IS NULL OR length(p_started) NOT BETWEEN 15 AND 64 OR
       position('T' IN p_started) = 0 OR
       p_inventory IS NULL OR octet_length(p_inventory) NOT BETWEEN 1 AND 4194304 OR
       p_witness IS NULL OR octet_length(p_witness) NOT BETWEEN 1 AND 4096 THEN
        RAISE EXCEPTION 'invalid nonfinal offhost WAL birth witness input'
            USING ERRCODE = '22023';
    END IF;

    -- Stable per-node transaction serialization, including concurrent FIRST
    -- registrations without any row to SELECT FOR UPDATE. Hash collisions
    -- may serialize unrelated nodes, but cannot let two writes race.
    PERFORM pg_advisory_xact_lock(1804071001, (p_node % 2147483647)::INTEGER);

    SELECT * INTO prior FROM quota_v2_offhost_birth_witnesses
      WHERE node_id = p_node ORDER BY inventory_sequence DESC LIMIT 1 FOR UPDATE;

    SELECT * INTO same FROM quota_v2_offhost_birth_witnesses
      WHERE node_id = p_node AND inventory_sequence = p_sequence FOR UPDATE;

    IF FOUND THEN
        IF same.inventory_sha256 IS DISTINCT FROM p_sha OR
           same.inventory_tail_digest IS DISTINCT FROM p_tail OR
           same.node_public_key_sha256 IS DISTINCT FROM p_key_sha OR
           same.old_container_id IS DISTINCT FROM p_container OR
           same.old_started_at IS DISTINCT FROM p_started OR
           same.full_inventory IS DISTINCT FROM p_inventory OR
           same.signed_node_witness IS DISTINCT FROM p_witness THEN
            RAISE EXCEPTION 'conflicting signed Xray WAL birth witness replay'
                USING ERRCODE = '22023';
        END IF;
        RETURN same;
    END IF;

    IF prior.node_id IS NOT NULL THEN
        IF p_sequence <= prior.inventory_sequence OR
           prior.node_public_key_sha256 <> p_key_sha OR
           substring(p_inventory FROM 1 FOR octet_length(prior.full_inventory))
               <> prior.full_inventory THEN
            RAISE EXCEPTION 'offhost WAL birth history rollback or Node key changed'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    INSERT INTO quota_v2_offhost_birth_witnesses (
       node_id, inventory_sequence, inventory_sha256, inventory_tail_digest,
       node_public_key_sha256, old_container_id, old_started_at,
       full_inventory, signed_node_witness, previous_inventory_sha256)
    VALUES (
       p_node, p_sequence, p_sha, p_tail, p_key_sha, p_container, p_started,
       p_inventory, p_witness, prior.inventory_sha256)
    RETURNING * INTO saved;
    RETURN saved;
END;
$$;

REVOKE ALL ON quota_v2_offhost_birth_witnesses FROM PUBLIC;
REVOKE ALL ON FUNCTION quota_v2_register_offhost_birth_witness(
    BIGINT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, BYTEA, BYTEA)
FROM PUBLIC;

COMMENT ON TABLE quota_v2_offhost_birth_witnesses IS
'Append-only off-host raw Xray WAL birth prefixes. NONFINAL audit only: no user admission, no traffic meter finality, no refunds, no live quota accounting. Node signature must be independently authenticated before SQL insertion.';
