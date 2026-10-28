-- P0-D staging foundation: immutable exact Agent release metadata.
-- This table is inert by itself: it does not activate XSP-v2, alter the existing
-- update_agent action, or authorize any download/apply operation.
CREATE TABLE node_xsp_agent_release_manifests (
 id BIGSERIAL PRIMARY KEY,
 version TEXT NOT NULL UNIQUE
   CHECK (version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'),
 source_revision TEXT NOT NULL
   CHECK (source_revision ~ '^[0-9a-f]{40}$'),
 artifact_sha256 TEXT NOT NULL
   CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
 created_by TEXT NOT NULL
   CHECK (length(created_by) BETWEEN 1 AND 128),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE (source_revision, artifact_sha256)
);

-- Release identity is append-only. A version can never be silently rebound to
-- different source/artifact bytes after an owner approved it.
CREATE OR REPLACE FUNCTION reject_node_xsp_agent_release_manifest_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
 RAISE EXCEPTION 'node_xsp_agent_release_manifests is append-only';
END;
$$;

CREATE TRIGGER node_xsp_agent_release_manifest_no_update_delete
BEFORE UPDATE OR DELETE ON node_xsp_agent_release_manifests
FOR EACH ROW EXECUTE FUNCTION reject_node_xsp_agent_release_manifest_mutation();

CREATE TRIGGER node_xsp_agent_release_manifest_no_truncate
BEFORE TRUNCATE ON node_xsp_agent_release_manifests
FOR EACH STATEMENT EXECUTE FUNCTION reject_node_xsp_agent_release_manifest_mutation();
