-- P0-D authenticated poll/apply/ACK identity: persist exact immutable release
-- identity on the existing fixed-action update_agent acknowledgement path.
-- Legacy unbound commands remain valid and keep their historical heartbeat
-- success fallback. Bound staging migrations may become succeeded only from an
-- identity-matching authenticated ACK; a version-only heartbeat must not turn
-- missing ACK evidence into success.
ALTER TABLE node_restart_commands
  ADD COLUMN release_ack_version TEXT,
  ADD COLUMN release_ack_source_revision TEXT,
  ADD COLUMN release_ack_artifact_sha256 TEXT,
  ADD COLUMN release_ack_success BOOLEAN,
  ADD COLUMN release_ack_received_at TIMESTAMPTZ;

ALTER TABLE node_restart_commands
  ADD CONSTRAINT node_restart_release_ack_all_or_none_check
  CHECK (
    (release_ack_version IS NULL
      AND release_ack_source_revision IS NULL
      AND release_ack_artifact_sha256 IS NULL
      AND release_ack_success IS NULL
      AND release_ack_received_at IS NULL)
    OR
    (release_manifest_id IS NOT NULL
      AND action = 'update_agent'
      AND release_ack_version IS NOT NULL
      AND release_ack_source_revision IS NOT NULL
      AND release_ack_artifact_sha256 IS NOT NULL
      AND release_ack_success IS NOT NULL
      AND release_ack_received_at IS NOT NULL
      AND state IN ('succeeded','failed')
      AND finished_at IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION validate_node_xsp_agent_release_ack_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  manifest_version TEXT;
  manifest_revision TEXT;
  manifest_digest TEXT;
BEGIN
  -- Once authenticated ACK evidence exists, it is historical evidence and may
  -- never be rewritten, removed or rebound by later lifecycle/heartbeat work.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.release_ack_received_at IS NOT NULL AND (
         NEW.release_ack_version IS DISTINCT FROM OLD.release_ack_version
         OR NEW.release_ack_source_revision IS DISTINCT FROM OLD.release_ack_source_revision
         OR NEW.release_ack_artifact_sha256 IS DISTINCT FROM OLD.release_ack_artifact_sha256
         OR NEW.release_ack_success IS DISTINCT FROM OLD.release_ack_success
         OR NEW.release_ack_received_at IS DISTINCT FROM OLD.release_ack_received_at
       ) THEN
      RAISE EXCEPTION 'XSP-v2 Agent release ACK identity is immutable';
    END IF;
  END IF;

  -- An unbound legacy command must never acquire fabricated migration identity.
  IF NEW.release_manifest_id IS NULL THEN
    IF NEW.release_ack_version IS NOT NULL
       OR NEW.release_ack_source_revision IS NOT NULL
       OR NEW.release_ack_artifact_sha256 IS NOT NULL
       OR NEW.release_ack_success IS NOT NULL
       OR NEW.release_ack_received_at IS NOT NULL THEN
      RAISE EXCEPTION 'legacy Agent command cannot carry XSP-v2 release ACK identity';
    END IF;
    RETURN NEW;
  END IF;

  SELECT version,source_revision,artifact_sha256
    INTO manifest_version,manifest_revision,manifest_digest
    FROM node_xsp_agent_release_manifests
    WHERE id = NEW.release_manifest_id;

  IF manifest_version IS NULL THEN
    RAISE EXCEPTION 'bound XSP-v2 Agent release manifest is missing';
  END IF;

  IF NEW.release_ack_received_at IS NOT NULL AND (
       NEW.release_ack_version IS DISTINCT FROM manifest_version
       OR NEW.release_ack_source_revision IS DISTINCT FROM manifest_revision
       OR NEW.release_ack_artifact_sha256 IS DISTINCT FROM manifest_digest
     ) THEN
    RAISE EXCEPTION 'XSP-v2 Agent release ACK identity mismatch';
  END IF;

  -- Preserve the historical version-only heartbeat fallback for legacy rows,
  -- but silently ignore it for bound migrations. This keeps heartbeat itself
  -- healthy while guaranteeing that a missing/failed identity ACK is never
  -- upgraded to success by a later matching-version heartbeat.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.state = 'succeeded'
       AND OLD.state IS DISTINCT FROM 'succeeded'
       AND (NEW.release_ack_received_at IS NULL OR NEW.release_ack_success IS DISTINCT FROM TRUE) THEN
      RETURN OLD;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER node_restart_validate_xsp_agent_release_ack_identity
BEFORE INSERT OR UPDATE ON node_restart_commands
FOR EACH ROW EXECUTE FUNCTION validate_node_xsp_agent_release_ack_identity();
