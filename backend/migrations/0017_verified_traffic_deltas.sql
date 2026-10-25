-- Immutable accepted increases from signed Xray counters.
-- A baseline, reset, repeated snapshot or unverifiable counter never creates usage.
-- 'user' and 'inbound' are independent metric families; never sum both.
CREATE TABLE verified_traffic_deltas (
    sampled_at TIMESTAMPTZ NOT NULL,
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    user_id BIGINT NOT NULL CHECK (user_id > 0),
    source_type TEXT NOT NULL CHECK (source_type IN ('user','inbound')),
    inbound_tag TEXT NOT NULL DEFAULT '',
    uplink_bytes BIGINT NOT NULL CHECK (uplink_bytes >= 0),
    downlink_bytes BIGINT NOT NULL CHECK (downlink_bytes >= 0),
    CHECK (uplink_bytes > 0 OR downlink_bytes > 0),
    CHECK ((source_type='user' AND inbound_tag='') OR
           (source_type='inbound' AND length(inbound_tag) BETWEEN 1 AND 128))
);
SELECT create_hypertable('verified_traffic_deltas', 'sampled_at', if_not_exists => TRUE);
CREATE INDEX verified_traffic_deltas_user_time_idx
    ON verified_traffic_deltas (user_id, sampled_at DESC);
CREATE INDEX verified_traffic_deltas_user_inbound_time_idx
    ON verified_traffic_deltas (user_id, inbound_tag, sampled_at DESC)
    WHERE source_type='inbound';
CREATE INDEX verified_traffic_deltas_node_time_idx
    ON verified_traffic_deltas (node_id, sampled_at DESC);
