-- Preserve classified legacy CDN deltas independently of owner resets.
-- Existing monthly rows have no reliable day attribution. Keep their
-- migration-time floor at month granularity and count it conservatively
-- in overlapping sub-month windows.
LOCK TABLE user_inbound_traffic_monthly IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE quota_v2_cdn_legacy_month_floor (
    user_id BIGINT NOT NULL,
    month_start DATE NOT NULL,
    bytes NUMERIC NOT NULL CHECK (bytes >= 0),
    PRIMARY KEY (user_id,month_start)
);

INSERT INTO quota_v2_cdn_legacy_month_floor(user_id,month_start,bytes)
SELECT user_id,month_start,SUM(quota_uplink_bytes::numeric+quota_downlink_bytes)
FROM user_inbound_traffic_monthly
GROUP BY user_id,month_start;

CREATE TRIGGER quota_v2_cdn_month_floor_immutable
BEFORE UPDATE OR DELETE ON quota_v2_cdn_legacy_month_floor
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE TRIGGER quota_v2_cdn_month_floor_no_truncate
BEFORE TRUNCATE ON quota_v2_cdn_legacy_month_floor
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE TABLE quota_v2_cdn_legacy_day_usage (
    user_id BIGINT NOT NULL,
    day_start DATE NOT NULL,
    bytes NUMERIC NOT NULL CHECK (bytes >= 0),
    PRIMARY KEY (user_id,day_start)
);

CREATE FUNCTION quota_v2_protect_cdn_day_usage()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' OR NEW.user_id<>OLD.user_id
       OR NEW.day_start<>OLD.day_start OR NEW.bytes<OLD.bytes THEN
        RAISE EXCEPTION 'CDN quota history cannot be reduced or moved'
            USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER quota_v2_cdn_day_monotonic
BEFORE UPDATE OR DELETE ON quota_v2_cdn_legacy_day_usage
FOR EACH ROW EXECUTE FUNCTION quota_v2_protect_cdn_day_usage();

CREATE TRIGGER quota_v2_cdn_day_no_truncate
BEFORE TRUNCATE ON quota_v2_cdn_legacy_day_usage
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE FUNCTION quota_v2_capture_cdn_delta()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    delta NUMERIC;
    bucket DATE := (NEW.updated_at AT TIME ZONE 'UTC')::date;
BEGIN
    IF TG_OP = 'INSERT' THEN
        delta := NEW.quota_uplink_bytes::numeric+NEW.quota_downlink_bytes;
    ELSE
        delta := GREATEST(NEW.quota_uplink_bytes::numeric-OLD.quota_uplink_bytes,0)
               + GREATEST(NEW.quota_downlink_bytes::numeric-OLD.quota_downlink_bytes,0);
    END IF;
    IF delta>0 THEN
        IF date_trunc('month',bucket::timestamp)::date<>NEW.month_start THEN
            RAISE EXCEPTION 'CDN telemetry bucket disagrees with server acceptance time'
                USING ERRCODE='23514';
        END IF;
        INSERT INTO quota_v2_cdn_legacy_day_usage AS usage(user_id,day_start,bytes)
        VALUES(NEW.user_id,bucket,delta)
        ON CONFLICT(user_id,day_start) DO UPDATE SET bytes=usage.bytes+EXCLUDED.bytes;
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER quota_v2_cdn_capture_legacy_delta
AFTER INSERT OR UPDATE OF quota_uplink_bytes,quota_downlink_bytes
ON user_inbound_traffic_monthly
FOR EACH ROW EXECUTE FUNCTION quota_v2_capture_cdn_delta();

CREATE VIEW quota_v2_cdn_legacy_windows AS
    SELECT user_id, quota_v2_calendar_window('daily',day_start::timestamp AT TIME ZONE 'UTC') AS span, bytes
      FROM quota_v2_cdn_legacy_day_usage
    UNION ALL
    SELECT user_id, quota_v2_calendar_window('monthly',month_start::timestamp AT TIME ZONE 'UTC'), bytes
      FROM quota_v2_cdn_legacy_month_floor;

ALTER TABLE quota_v2_cdn_calendar_bindings
    DROP CONSTRAINT quota_v2_cdn_calendar_bindings_period_check,
    ADD CONSTRAINT quota_v2_cdn_calendar_bindings_period_check
        CHECK (period IN ('daily','weekly','monthly'));

CREATE FUNCTION quota_v2_cdn_calendar_remaining(
    p_user BIGINT, p_period TEXT, p_limit BIGINT, p_at TIMESTAMPTZ
) RETURNS BIGINT LANGUAGE sql STABLE STRICT AS $$
    WITH w AS (SELECT quota_v2_calendar_window(p_period,p_at) AS span)
    SELECT CASE WHEN w.span IS NOT NULL THEN
      GREATEST((-9223372036854775807)::numeric, p_limit::numeric
      - COALESCE((SELECT SUM(t.bytes) FROM quota_v2_cdn_legacy_windows t
          WHERE t.user_id=p_user AND t.span && w.span),0)
      - COALESCE((SELECT SUM(CASE
              WHEN s.class='mixed' AND h.held_bytes IS NOT NULL
              THEN h.held_bytes::numeric+COALESCE((SELECT SUM(t.added_bytes::numeric)
                   FROM quota_v2_mixed_cdn_topups t WHERE t.reservation_id=r.reservation_id),0)
              ELSE r.ceiling_bytes::numeric END)
          FROM quota_v2_reservations r
          LEFT JOIN quota_v2_reservation_classes s USING(reservation_id)
          LEFT JOIN quota_v2_mixed_cdn_holds h USING(reservation_id)
          LEFT JOIN quota_v2_cdn_calendar_bindings b USING(reservation_id)
          WHERE r.user_id=p_user AND s.class IS DISTINCT FROM 'main'
            AND (b.reservation_id IS NULL OR b.calendar_window && w.span)),0))::bigint
    END FROM w
$$;

CREATE OR REPLACE FUNCTION quota_v2_cdn_calendar_remaining(
    p_user BIGINT, p_limit BIGINT, p_at TIMESTAMPTZ
) RETURNS BIGINT LANGUAGE sql STABLE STRICT AS $$
    SELECT quota_v2_cdn_calendar_remaining(p_user,'monthly',p_limit,p_at)
$$;

REVOKE ALL ON quota_v2_cdn_legacy_month_floor,quota_v2_cdn_legacy_day_usage,
    quota_v2_cdn_legacy_windows FROM PUBLIC;
REVOKE ALL ON FUNCTION quota_v2_cdn_calendar_remaining(BIGINT,TEXT,BIGINT,TIMESTAMPTZ) FROM PUBLIC;
