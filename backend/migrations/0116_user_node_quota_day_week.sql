-- Independent per-user/per-node UTC calendar day and ISO week meters.
-- The week begins Monday 00:00 UTC (PostgreSQL date_trunc('week')).
-- No background reset or manipulation of lifetime/monthly ledgers is needed:
-- selecting the current partition makes a new period start at zero.
-- Only positive deltas from authenticated "user" telemetry are charged.
CREATE TABLE user_node_quota_daily (
    day_start DATE NOT NULL,
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    user_id BIGINT NOT NULL CHECK (user_id > 0),
    uplink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (uplink_bytes >= 0),
    downlink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (downlink_bytes >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (day_start, node_id, user_id)
);
CREATE INDEX user_node_quota_daily_user_period_idx
    ON user_node_quota_daily (user_id, day_start);

CREATE TABLE user_node_quota_weekly (
    week_start DATE NOT NULL,
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    user_id BIGINT NOT NULL CHECK (user_id > 0),
    uplink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (uplink_bytes >= 0),
    downlink_bytes BIGINT NOT NULL DEFAULT 0 CHECK (downlink_bytes >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (week_start, node_id, user_id)
);
CREATE INDEX user_node_quota_weekly_user_period_idx
    ON user_node_quota_weekly (user_id, week_start);

-- Seed only the current UTC day/week from already persisted, signed positive
-- user deltas. No approximation from cumulative Xray values, no inbound
-- double-counting, and no retroactive history outside the available ledger.
INSERT INTO user_node_quota_daily (day_start,node_id,user_id,uplink_bytes,downlink_bytes)
SELECT date_trunc('day', sampled_at AT TIME ZONE 'UTC')::date,
       node_id, user_id,
       COALESCE(SUM(uplink_bytes),0)::BIGINT,
       COALESCE(SUM(downlink_bytes),0)::BIGINT
FROM verified_traffic_deltas
WHERE source_type='user'
  AND sampled_at >= (date_trunc('day',NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
  AND sampled_at <= NOW()
GROUP BY date_trunc('day', sampled_at AT TIME ZONE 'UTC')::date,node_id,user_id
ON CONFLICT (day_start,node_id,user_id) DO NOTHING;

INSERT INTO user_node_quota_weekly (week_start,node_id,user_id,uplink_bytes,downlink_bytes)
SELECT date_trunc('week', sampled_at AT TIME ZONE 'UTC')::date,
       node_id, user_id,
       COALESCE(SUM(uplink_bytes),0)::BIGINT,
       COALESCE(SUM(downlink_bytes),0)::BIGINT
FROM verified_traffic_deltas
WHERE source_type='user'
  AND sampled_at >= (date_trunc('week',NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
  AND sampled_at <= NOW()
GROUP BY date_trunc('week', sampled_at AT TIME ZONE 'UTC')::date,node_id,user_id
ON CONFLICT (week_start,node_id,user_id) DO NOTHING;
