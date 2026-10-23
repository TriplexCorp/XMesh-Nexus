-- Explicit control-plane requests. Metrics/heartbeats never authorize an implicit restart.
-- Only the signed node agent can claim/ack its own fixed restart_xray action.
CREATE TABLE node_restart_commands (
 id BIGSERIAL PRIMARY KEY,
 node_id BIGINT NOT NULL REFERENCES node_metric_keys(node_id) ON DELETE CASCADE,
 action TEXT NOT NULL DEFAULT 'restart_xray' CHECK (action='restart_xray'),
 state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','succeeded','failed')),
 requested_by TEXT NOT NULL CHECK (length(requested_by) BETWEEN 1 AND 128),
 requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 claimed_at TIMESTAMPTZ,
 finished_at TIMESTAMPTZ,
 result TEXT NOT NULL DEFAULT '' CHECK (length(result)<=256)
);
CREATE UNIQUE INDEX node_restart_one_active
 ON node_restart_commands(node_id) WHERE state IN ('pending','claimed');
CREATE INDEX node_restart_status_by_node
 ON node_restart_commands(node_id,id DESC);
