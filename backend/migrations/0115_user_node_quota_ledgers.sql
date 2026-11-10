-- Independent, server-authoritative per-user/per-node quota ledgers.
-- Only deltas from signed monotonic "user" telemetry enter these tables.
-- Neither general user traffic reset nor CDN reset may change these charges.
-- Existing cumulative signed totals seed the lifetime ledger once, while the
-- current month's immutable verified deltas seed the monthly ledger.
CREATE TABLE user_node_quota_lifetime (
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    user_id BIGINT NOT NULL CHECK (user_id > 0),
    uplink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (uplink_bytes >= 0),
    downlink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (downlink_bytes >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (node_id, user_id)
);
CREATE INDEX user_node_quota_lifetime_user_idx
    ON user_node_quota_lifetime (user_id);

INSERT INTO user_node_quota_lifetime (node_id,user_id,uplink_bytes,downlink_bytes)
SELECT node_id,user_id,uplink_bytes,downlink_bytes
FROM user_node_traffic_totals
ON CONFLICT (node_id,user_id) DO NOTHING;

CREATE TABLE user_node_quota_monthly (
    month_start DATE NOT NULL,
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    user_id BIGINT NOT NULL CHECK (user_id > 0),
    uplink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (uplink_bytes >= 0),
    downlink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (downlink_bytes >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (month_start, node_id, user_id)
);
CREATE INDEX user_node_quota_monthly_user_period_idx
    ON user_node_quota_monthly (user_id, month_start);

-- Backfill this month from authenticated *user* deltas only. Never add inbound
-- deltas to user totals or invent usage for missing historical intervals.
INSERT INTO user_node_quota_monthly (month_start,node_id,user_id,uplink_bytes,downlink_bytes)
SELECT date_trunc('month', sampled_at AT TIME ZONE 'UTC')::date, node_id, user_id,
       COALESCE(SUM(uplink_bytes),0)::BIGINT,
       COALESCE(SUM(downlink_bytes),0)::BIGINT
FROM verified_traffic_deltas
WHERE source_type='user'
  AND sampled_at >= (date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
GROUP BY date_trunc('month', sampled_at AT TIME ZONE 'UTC')::date,node_id,user_id
ON CONFLICT (month_start,node_id,user_id) DO NOTHING;
