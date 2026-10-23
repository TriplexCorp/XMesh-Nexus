-- Store exact approved Xray version for a queued managed-node update.
-- NULL remains valid only for legacy update jobs; new requests must supply
-- a concrete GitHub release tag.
ALTER TABLE node_restart_commands ADD COLUMN target_version TEXT;
ALTER TABLE node_restart_commands ADD CONSTRAINT node_restart_target_version_check
 CHECK (target_version IS NULL OR
        (length(target_version) BETWEEN 1 AND 64 AND
         target_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]*$'));
