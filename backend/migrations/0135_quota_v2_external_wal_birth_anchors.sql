-- Quota V2 CI-only, NONAUTHORITATIVE off-node WAL birth-index evidence.
--
-- The 0134 shadow carryforward stays outside live quota accounting.
-- This table is likewise FORENSIC ONLY: no settled/floor/reservation changes.
-- SQL cannot verify Node Ed25519 or physical Xray WALs; a separate
-- independently enrolled verifier must check signed FULL birth-index bytes
-- BEFORE calling this append-only persistence primitive. An arbitrary SQL
-- owner can stage an INVALID witness, but can neither mint credits nor cause
-- Nexus to issue a signed receipt without that separate verification.
--
-- On every witness, persist the FULL previously fsynced Node birth registry
-- as bytes. A digest-only record cannot prove that a newer registry extends
-- the old prefix: a malicious Node could supply a different same-length
-- index while re-signing its hash. Full bytes make prefix replay testable.
--
-- A first nonempty registry witness is only a BOOTSTRAP. It cannot prove
-- that nobody deleted older WALs before the first off-node registration.
CREATE TABLE quota_v2_external_wal_birth_anchors (
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    inventory_sequence INT NOT NULL CHECK (
        inventory_sequence BETWEEN 1 AND 4096),
    inventory_sha256 TEXT NOT NULL CHECK (
        inventory_sha256 ~ '^[0-9a-f]{64}$'),
    inventory_tail_digest TEXT NOT NULL CHECK (
        inventory_tail_digest ~ '^[0-9a-f]{64}$'),
    original_node_witness_sha256 TEXT NOT NULL UNIQUE CHECK (
        original_node_witness_sha256 ~ '^[0-9a-f]{64}$'),
    old_container_id TEXT NOT NULL CHECK (
        old_container_id ~ '^[0-9a-f]{64}$'),
    old_started_at TEXT NOT NULL CHECK (
        length(old_started_at) BETWEEN 15 AND 64
        AND position('T' IN old_started_at) > 0),
    inventory_bytes BYTEA NOT NULL CHECK (
        octet_length(inventory_bytes) BETWEEN 1 AND 4194304),
    first_external_witness BOOLEAN NOT NULL,
    witnessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(node_id,inventory_sequence),
    UNIQUE(node_id,inventory_sha256)
);
CREATE FUNCTION quota_v2_external_wal_birth_anchor_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'external Xray WAL birth witness is immutable'
        USING ERRCODE='22023';
END;
$$;
CREATE TRIGGER quota_v2_external_wal_birth_anchor_immutable_trg
BEFORE UPDATE OR DELETE ON quota_v2_external_wal_birth_anchors
FOR EACH ROW EXECUTE FUNCTION quota_v2_external_wal_birth_anchor_immutable();

CREATE FUNCTION quota_v2_store_external_wal_birth_anchor(
    p_node BIGINT,p_sequence INT,p_inventory_sha TEXT,p_tail TEXT,
    p_original_witness_sha TEXT,p_container_id TEXT,p_started_at TEXT,
    p_inventory BYTEA
) RETURNS quota_v2_external_wal_birth_anchors LANGUAGE plpgsql AS $$
DECLARE
    prior quota_v2_external_wal_birth_anchors;
    saved quota_v2_external_wal_birth_anchors;
    utf8 TEXT;
BEGIN
    IF p_node IS NULL OR p_node<=0 OR
       p_sequence IS NULL OR p_sequence NOT BETWEEN 1 AND 4096 OR
       p_inventory_sha IS NULL OR p_inventory_sha !~ '^[0-9a-f]{64}$' OR
       p_tail IS NULL OR p_tail !~ '^[0-9a-f]{64}$' OR
       p_original_witness_sha IS NULL OR
       p_original_witness_sha !~ '^[0-9a-f]{64}$' OR
       p_container_id IS NULL OR p_container_id !~ '^[0-9a-f]{64}$' OR
       p_started_at IS NULL OR
       length(p_started_at) NOT BETWEEN 15 AND 64 OR
       position('T' IN p_started_at)=0 OR
       p_inventory IS NULL OR
       octet_length(p_inventory) NOT BETWEEN 1 AND 4194304
    THEN
        RAISE EXCEPTION 'invalid external WAL index witness input'
            USING ERRCODE='22023';
    END IF;
    -- PostgreSQL 17 built-in SHA-256 over exact original raw bytes.
    -- Never trust a caller-provided registry hash without recomputing it.
    IF encode(sha256(p_inventory),'hex') IS DISTINCT FROM p_inventory_sha THEN
        RAISE EXCEPTION 'raw external WAL birth index sha256 differs'
            USING ERRCODE='22023';
    END IF;
    utf8:=convert_from(p_inventory,'UTF8');
    IF right(utf8,1) IS DISTINCT FROM E'\n' OR
       length(utf8)-length(replace(utf8,E'\n',''))<>p_sequence THEN
        RAISE EXCEPTION 'external Xray registry count or newline differs'
            USING ERRCODE='22023';
    END IF;

    -- Serialize even the FIRST witness for a node: row-level SELECT
    -- FOR UPDATE alone cannot lock an empty table. Hash collisions on the
    -- advisory key can only serialize unrelated nodes, not cross-wire them.
    PERFORM pg_advisory_xact_lock(1794501,hashtext(p_node::TEXT));
    SELECT * INTO prior FROM quota_v2_external_wal_birth_anchors
      WHERE node_id=p_node ORDER BY inventory_sequence DESC LIMIT 1;
    IF FOUND THEN
        IF p_sequence<prior.inventory_sequence THEN
            RAISE EXCEPTION 'Node inventory rolled back behind external witness'
                USING ERRCODE='22023';
        END IF;
        IF p_sequence=prior.inventory_sequence THEN
            IF p_inventory_sha IS DISTINCT FROM prior.inventory_sha256 OR
               p_tail IS DISTINCT FROM prior.inventory_tail_digest OR
               p_original_witness_sha IS DISTINCT FROM
                   prior.original_node_witness_sha256 OR
               p_container_id IS DISTINCT FROM prior.old_container_id OR
               p_started_at IS DISTINCT FROM prior.old_started_at OR
               p_inventory IS DISTINCT FROM prior.inventory_bytes THEN
                RAISE EXCEPTION 'conflicting off-node inventory witness replay'
                    USING ERRCODE='22023';
            END IF;
            RETURN prior;
        END IF;
        -- Complete old registry must be an exact prefix of new source.
        -- Sequence-only and hash-only checks are insufficient.
        IF octet_length(p_inventory)<=octet_length(prior.inventory_bytes) OR
           substring(p_inventory from 1 for
                     octet_length(prior.inventory_bytes)) IS DISTINCT FROM
                     prior.inventory_bytes THEN
            RAISE EXCEPTION 'forked Xray WAL birth registry: old remote prefix lost'
                USING ERRCODE='22023';
        END IF;
    END IF;

    INSERT INTO quota_v2_external_wal_birth_anchors(
      node_id,inventory_sequence,inventory_sha256,inventory_tail_digest,
      original_node_witness_sha256,old_container_id,old_started_at,
      inventory_bytes,first_external_witness
    ) VALUES (
      p_node,p_sequence,p_inventory_sha,p_tail,p_original_witness_sha,
      p_container_id,p_started_at,p_inventory,prior.node_id IS NULL
    ) RETURNING * INTO saved;
    RETURN saved;
END;
$$;

REVOKE ALL ON quota_v2_external_wal_birth_anchors FROM PUBLIC;
REVOKE ALL ON FUNCTION quota_v2_store_external_wal_birth_anchor(
    BIGINT,INT,TEXT,TEXT,TEXT,TEXT,TEXT,BYTEA
) FROM PUBLIC;
COMMENT ON TABLE quota_v2_external_wal_birth_anchors IS
'Nonfinal off-host FULL WAL birth index checkpoint. Bootstrap does not prove earlier history. Never used for quota spending, release, refund or final byte evidence.';
COMMENT ON FUNCTION quota_v2_store_external_wal_birth_anchor(
    BIGINT,INT,TEXT,TEXT,TEXT,TEXT,TEXT,BYTEA
) IS
'NO embedded Ed25519 verification: only an independent trusted service may invoke after verifying Node signature and canonical Xray inventory. Direct SQL cannot authorize spending/refunds.';
