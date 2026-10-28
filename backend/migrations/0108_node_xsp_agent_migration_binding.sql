-- P0-D staging foundation: atomically bind an existing fixed-action update_agent
-- command to one immutable Agent release manifest. No HTTP/API caller invokes
-- this primitive yet; production update behavior remains unchanged.
ALTER TABLE node_restart_commands
  ADD COLUMN release_manifest_id BIGINT
  REFERENCES node_xsp_agent_release_manifests(id) ON DELETE RESTRICT;

ALTER TABLE node_restart_commands
  ADD CONSTRAINT node_restart_release_manifest_action_check
  CHECK (release_manifest_id IS NULL OR action = 'update_agent');

CREATE INDEX node_restart_release_manifest_idx
  ON node_restart_commands(release_manifest_id)
  WHERE release_manifest_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_node_xsp_agent_migration_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  manifest_version TEXT;
BEGIN
  IF NEW.release_manifest_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT version INTO manifest_version
    FROM node_xsp_agent_release_manifests
    WHERE id = NEW.release_manifest_id;
  IF manifest_version IS NULL
     OR NEW.action <> 'update_agent'
     OR NEW.target_version IS DISTINCT FROM manifest_version THEN
    RAISE EXCEPTION 'invalid XSP-v2 Agent migration binding';
  END IF;

  IF TG_OP = 'UPDATE' AND (
       NEW.release_manifest_id IS DISTINCT FROM OLD.release_manifest_id
       OR NEW.node_id IS DISTINCT FROM OLD.node_id
       OR NEW.action IS DISTINCT FROM OLD.action
       OR NEW.target_version IS DISTINCT FROM OLD.target_version
       OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     ) THEN
    RAISE EXCEPTION 'bound XSP-v2 Agent migration identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER node_restart_validate_xsp_agent_migration_binding
BEFORE INSERT OR UPDATE ON node_restart_commands
FOR EACH ROW EXECUTE FUNCTION validate_node_xsp_agent_migration_binding();

-- Staging-only building block for a later owner-authenticated API. It reuses
-- the existing single-flight update_agent queue and never accepts a URL,
-- script, command, digest override or unregistered release identity.
CREATE OR REPLACE FUNCTION stage_node_xsp_agent_migration(
  p_node_id BIGINT,
  p_version TEXT,
  p_requested_by TEXT
)
RETURNS TABLE(
  command_id BIGINT,
  manifest_id BIGINT,
  version TEXT,
  source_revision TEXT,
  artifact_sha256 TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  manifest node_xsp_agent_release_manifests%ROWTYPE;
  queued_id BIGINT;
BEGIN
  IF p_node_id <= 0 OR p_requested_by IS NULL
     OR length(p_requested_by) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'invalid XSP-v2 Agent migration request';
  END IF;

  SELECT * INTO STRICT manifest
    FROM node_xsp_agent_release_manifests
    WHERE node_xsp_agent_release_manifests.version = p_version;

  INSERT INTO node_restart_commands(
    node_id, action, requested_by, target_version, release_manifest_id
  ) VALUES (
    p_node_id, 'update_agent', p_requested_by, manifest.version, manifest.id
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO queued_id;

  IF queued_id IS NULL THEN
    RAISE EXCEPTION 'node already has an active control command';
  END IF;

  RETURN QUERY SELECT queued_id, manifest.id, manifest.version,
                      manifest.source_revision, manifest.artifact_sha256;
END;
$$;
