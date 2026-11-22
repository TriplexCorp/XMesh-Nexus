-- The shared Xray cap for a mixed MAIN/CDN node is distinct from the
-- separately prefunded CDN sub-ceiling. An immutable row pins the ORIGINAL
-- cumulative CDN allowance; subsequent MAIN refills cannot increase it.
-- Never refund the CDN hold when a Node is offline, a period changes, or
-- WAL becomes unavailable. An unclassified historic mixed lease without a
-- row remains liable for its entire shared ceiling (fail closed).
CREATE TABLE quota_v2_mixed_cdn_holds (
    reservation_id UUID PRIMARY KEY REFERENCES quota_v2_reservations(reservation_id),
    user_id BIGINT NOT NULL CHECK(user_id > 0),
    node_id BIGINT NOT NULL CHECK(node_id > 0),
    held_bytes BIGINT NOT NULL CHECK(held_bytes >= 0 AND held_bytes <= 67108864),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX quota_v2_mixed_cdn_holds_user_idx
    ON quota_v2_mixed_cdn_holds(user_id);

CREATE TRIGGER quota_v2_mixed_cdn_holds_immutable
BEFORE UPDATE OR DELETE ON quota_v2_mixed_cdn_holds
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE TRIGGER quota_v2_mixed_cdn_holds_no_truncate
BEFORE TRUNCATE ON quota_v2_mixed_cdn_holds
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

REVOKE ALL ON quota_v2_mixed_cdn_holds FROM PUBLIC;
