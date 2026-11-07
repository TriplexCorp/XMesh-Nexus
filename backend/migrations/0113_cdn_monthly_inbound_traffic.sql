-- Monthly user+inbound+node traffic charged only from verified, monotonically
-- increasing signed counters. Policy attribution is frozen at ingestion time:
-- deleting a node or changing its classification never erases charged usage.
-- Month transitions follow the server's UTC calendar. No backfill from lifetime
-- counters is possible without timestamped historical deltas.
CREATE TABLE user_inbound_traffic_monthly (
    month_start DATE NOT NULL,
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    user_id BIGINT NOT NULL CHECK (user_id > 0),
    inbound_tag TEXT NOT NULL CHECK (length(inbound_tag) BETWEEN 1 AND 128),
    quota_uplink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (quota_uplink_bytes >= 0),
    quota_downlink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (quota_downlink_bytes >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (month_start, node_id, user_id, inbound_tag)
);
CREATE INDEX user_inbound_traffic_monthly_user_month_idx
    ON user_inbound_traffic_monthly(user_id, month_start);
