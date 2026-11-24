-- Immutable pre-v2 node usage anchors. A lifetime Node quota cannot silently
-- treat older signed V1/telemetry consumption as new spendable capacity.
-- New V2 commitments are charged conservatively at their FULL issued
-- ceiling, including old/closed periods: no unverifiable refund.
CREATE TABLE quota_v2_node_lifetime_baselines (
    user_id BIGINT NOT NULL CHECK(user_id > 0),
    node_id BIGINT NOT NULL CHECK(node_id > 0),
    baseline_bytes BIGINT NOT NULL CHECK(baseline_bytes >= 0),
    anchored_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(user_id,node_id)
);

CREATE TRIGGER quota_v2_node_lifetime_baselines_immutable
BEFORE UPDATE OR DELETE ON quota_v2_node_lifetime_baselines
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE TRIGGER quota_v2_node_lifetime_baselines_no_truncate
BEFORE TRUNCATE ON quota_v2_node_lifetime_baselines
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

REVOKE ALL ON quota_v2_node_lifetime_baselines FROM PUBLIC;
