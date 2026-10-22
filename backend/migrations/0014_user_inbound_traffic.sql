-- Reliable per-user, per-inbound, per-node cumulative counters.
-- Only genuine, agent-supplied counters may populate this table.
-- No aggregation of overall user traffic and inbound traffic is valid.
CREATE TABLE user_inbound_traffic_totals (
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    user_id BIGINT NOT NULL CHECK (user_id > 0),
    inbound_tag TEXT NOT NULL CHECK (length(inbound_tag) BETWEEN 1 AND 128),
    last_uplink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (last_uplink_bytes >= 0),
    last_downlink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (last_downlink_bytes >= 0),
    uplink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (uplink_bytes >= 0),
    downlink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (downlink_bytes >= 0),
    observations BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (node_id, user_id, inbound_tag)
);
CREATE INDEX user_inbound_traffic_totals_user_idx ON user_inbound_traffic_totals(user_id);
