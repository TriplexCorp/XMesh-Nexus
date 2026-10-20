-- Per-user traffic snapshots reported by authenticated node agents.
-- Counters are cumulative within one node/Xray runtime and may reset on restart.
-- The first snapshot sets the baseline; subsequent increases are counted.
-- This intentionally does not attribute host-wide network bytes to users.
CREATE TABLE IF NOT EXISTS user_node_traffic_totals (
  node_id BIGINT NOT NULL CHECK (node_id > 0),
  user_id BIGINT NOT NULL CHECK (user_id > 0),
  last_uplink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (last_uplink_bytes >= 0),
  last_downlink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (last_downlink_bytes >= 0),
  uplink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (uplink_bytes >= 0),
  downlink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (downlink_bytes >= 0),
  observations BIGINT NOT NULL DEFAULT 1 CHECK (observations >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (node_id,user_id)
);
CREATE INDEX IF NOT EXISTS user_node_traffic_totals_user_idx
  ON user_node_traffic_totals (user_id, updated_at DESC);
