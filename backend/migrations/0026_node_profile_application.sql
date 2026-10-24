-- Applied Xray revision is attested by the signed node heartbeat.
ALTER TABLE node_runtime_heartbeats
  ADD COLUMN IF NOT EXISTS applied_revision TEXT;
CREATE TABLE IF NOT EXISTS node_desired_revisions (
  node_id BIGINT PRIMARY KEY REFERENCES node_metric_keys(node_id) ON DELETE CASCADE,
  profile_id BIGINT NOT NULL,
  revision TEXT NOT NULL,
  served_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT node_desired_revision_hex CHECK (revision ~ '^[0-9a-f]{64}$')
);
