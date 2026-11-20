-- Retain the exact signed Node envelope required to verify an off-host
-- checkpoint after the local copy is lost. A digest cannot replace it.
CREATE TABLE quota_v2_external_wal_birth_sources (
    node_id BIGINT NOT NULL,
    inventory_sequence INT NOT NULL,
    witness_bytes BYTEA NOT NULL CHECK (
        octet_length(witness_bytes) BETWEEN 1 AND 8192),
    PRIMARY KEY (node_id, inventory_sequence),
    FOREIGN KEY (node_id, inventory_sequence)
        REFERENCES quota_v2_external_wal_birth_anchors (node_id, inventory_sequence)
);

CREATE TRIGGER quota_v2_external_wal_birth_sources_immutable_trg
BEFORE UPDATE OR DELETE ON quota_v2_external_wal_birth_sources
FOR EACH ROW EXECUTE FUNCTION quota_v2_external_wal_birth_anchor_immutable();

CREATE TRIGGER quota_v2_external_wal_birth_sources_no_truncate_trg
BEFORE TRUNCATE ON quota_v2_external_wal_birth_sources
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_external_wal_birth_anchor_immutable();

REVOKE ALL ON quota_v2_external_wal_birth_sources FROM PUBLIC;

COMMENT ON TABLE quota_v2_external_wal_birth_sources IS
'Exact signed Node witness bytes bound to a nonfinal external WAL checkpoint. Legacy checkpoints require exact Node witness resubmission before recovery verification.';
