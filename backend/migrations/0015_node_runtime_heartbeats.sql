-- Node control-plane heartbeat distinct from the metrics collector.
-- Signed Ed25519 identity is reused, but every signature binds its own HTTP path.
CREATE TABLE node_runtime_heartbeats (
 node_id BIGINT PRIMARY KEY REFERENCES node_metric_keys(node_id) ON DELETE CASCADE,
 version TEXT NOT NULL,
 router_running BOOLEAN NOT NULL,
 xray_running BOOLEAN NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX node_runtime_heartbeats_recent_idx ON node_runtime_heartbeats(received_at);
