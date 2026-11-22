-- Conservative independent *lifetime* CDN budget. All committed ceilings
-- for a CDN-only or mixed Node consume the pooled CDN budget in full.
-- A positive V2 cap cannot be retroactively reclassified as MAIN.
-- Unknown historic leases also count against CDN to avoid free capacity.
CREATE TABLE quota_v2_cdn_lifetime_baselines (
    user_id BIGINT PRIMARY KEY CHECK (user_id > 0),
    baseline_bytes BIGINT NOT NULL CHECK (baseline_bytes >= 0),
    anchored_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE quota_v2_reservation_classes (
    reservation_id UUID PRIMARY KEY REFERENCES quota_v2_reservations(reservation_id),
    user_id BIGINT NOT NULL CHECK (user_id > 0),
    node_id BIGINT NOT NULL CHECK (node_id > 0),
    class TEXT NOT NULL CHECK (class IN ('main','cdn','mixed','unclassified')),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX quota_v2_reservation_classes_user_class
    ON quota_v2_reservation_classes(user_id,class);

CREATE TRIGGER quota_v2_cdn_lifetime_baselines_immutable
BEFORE UPDATE OR DELETE ON quota_v2_cdn_lifetime_baselines
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();
CREATE TRIGGER quota_v2_cdn_lifetime_baselines_no_truncate
BEFORE TRUNCATE ON quota_v2_cdn_lifetime_baselines
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE TRIGGER quota_v2_reservation_classes_immutable
BEFORE UPDATE OR DELETE ON quota_v2_reservation_classes
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();
CREATE TRIGGER quota_v2_reservation_classes_no_truncate
BEFORE TRUNCATE ON quota_v2_reservation_classes
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

REVOKE ALL ON quota_v2_cdn_lifetime_baselines FROM PUBLIC;
REVOKE ALL ON quota_v2_reservation_classes FROM PUBLIC;
