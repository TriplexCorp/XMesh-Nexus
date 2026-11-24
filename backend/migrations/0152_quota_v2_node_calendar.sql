-- Immutable UTC binding for the experimental signed per-Node period.
CREATE FUNCTION quota_v2_calendar_window(p_period TEXT, p_at TIMESTAMPTZ)
RETURNS TSTZRANGE LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT CASE p_period
      WHEN 'daily' THEN tstzrange(
          date_trunc('day', p_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
          (date_trunc('day', p_at AT TIME ZONE 'UTC') + INTERVAL '1 day') AT TIME ZONE 'UTC')
      WHEN 'weekly' THEN tstzrange(
          date_trunc('week', p_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
          (date_trunc('week', p_at AT TIME ZONE 'UTC') + INTERVAL '1 week') AT TIME ZONE 'UTC')
      WHEN 'monthly' THEN tstzrange(
          date_trunc('month', p_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
          (date_trunc('month', p_at AT TIME ZONE 'UTC') + INTERVAL '1 month') AT TIME ZONE 'UTC')
    END
$$;

CREATE TABLE quota_v2_node_calendar_bindings (
    reservation_id UUID PRIMARY KEY REFERENCES quota_v2_reservations(reservation_id)
        DEFERRABLE INITIALLY DEFERRED,
    period TEXT NOT NULL CHECK (period IN ('daily','weekly','monthly')),
    calendar_window TSTZRANGE NOT NULL,
    CHECK (NOT isempty(calendar_window) AND NOT lower_inf(calendar_window) AND NOT upper_inf(calendar_window)
        AND calendar_window = quota_v2_calendar_window(period, lower(calendar_window)))
);

CREATE TRIGGER quota_v2_node_calendar_immutable
BEFORE UPDATE OR DELETE ON quota_v2_node_calendar_bindings
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE TRIGGER quota_v2_node_calendar_no_truncate
BEFORE TRUNCATE ON quota_v2_node_calendar_bindings
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE FUNCTION quota_v2_node_calendar_validate_lease()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE bound_window TSTZRANGE;
BEGIN
    IF TG_TABLE_NAME = 'quota_v2_node_calendar_bindings' THEN
        IF EXISTS (SELECT 1 FROM quota_v2_reservations
                   WHERE reservation_id=NEW.reservation_id
                     AND (ceiling_bytes>0 OR valid_until>upper(NEW.calendar_window))) THEN
            RAISE EXCEPTION 'an issued reservation cannot change its quota window'
                USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END IF;
    SELECT calendar_window INTO bound_window FROM quota_v2_node_calendar_bindings
        WHERE reservation_id=NEW.reservation_id;
    IF FOUND AND (
        NEW.valid_until > upper(bound_window)
        OR ((TG_OP = 'INSERT' OR NEW.revision <> OLD.revision)
            AND NOT bound_window @> clock_timestamp())
    ) THEN
        RAISE EXCEPTION 'reservation outside its original quota window'
            USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER quota_v2_node_calendar_only_before_issuance
BEFORE INSERT ON quota_v2_node_calendar_bindings
FOR EACH ROW EXECUTE FUNCTION quota_v2_node_calendar_validate_lease();

CREATE TRIGGER quota_v2_node_calendar_enforce_deadline
BEFORE INSERT OR UPDATE OF revision, valid_until ON quota_v2_reservations
FOR EACH ROW EXECUTE FUNCTION quota_v2_node_calendar_validate_lease();

REVOKE ALL ON quota_v2_node_calendar_bindings FROM PUBLIC;

CREATE FUNCTION quota_v2_node_calendar_remaining(
    p_user BIGINT, p_node BIGINT, p_period TEXT, p_limit BIGINT, p_at TIMESTAMPTZ
) RETURNS BIGINT LANGUAGE sql STABLE STRICT AS $$
    WITH w AS (SELECT quota_v2_calendar_window(p_period,p_at) AS span),
    legacy AS (
        SELECT CASE p_period
          WHEN 'daily' THEN (
              SELECT uplink_bytes::numeric + downlink_bytes FROM user_node_quota_daily
              WHERE user_id=p_user AND node_id=p_node
                AND day_start=(lower(w.span) AT TIME ZONE 'UTC')::date)
          WHEN 'weekly' THEN (
              SELECT uplink_bytes::numeric + downlink_bytes FROM user_node_quota_weekly
              WHERE user_id=p_user AND node_id=p_node
                AND week_start=(lower(w.span) AT TIME ZONE 'UTC')::date)
          WHEN 'monthly' THEN (
              SELECT uplink_bytes::numeric + downlink_bytes FROM user_node_quota_monthly
              WHERE user_id=p_user AND node_id=p_node
                AND month_start=(lower(w.span) AT TIME ZONE 'UTC')::date)
        END AS used FROM w
    )
    SELECT CASE WHEN w.span IS NOT NULL THEN
        GREATEST((-9223372036854775807)::numeric, p_limit::numeric - COALESCE(legacy.used,0) -
            COALESCE((SELECT SUM(r.ceiling_bytes::numeric) FROM quota_v2_reservations r
              LEFT JOIN quota_v2_node_calendar_bindings b USING(reservation_id)
              WHERE r.user_id=p_user AND r.node_id=p_node
                AND (b.reservation_id IS NULL OR b.calendar_window && w.span)),0))::bigint
    END FROM w CROSS JOIN legacy
$$;

REVOKE ALL ON FUNCTION quota_v2_node_calendar_remaining(BIGINT,BIGINT,TEXT,BIGINT,TIMESTAMPTZ) FROM PUBLIC;

-- Keep the immutable signed envelope inside its reservation's window even
-- if another issuer path is introduced. The signature itself is verified
-- by the normal Nexus and Xray Ed25519 implementations.
CREATE FUNCTION quota_v2_node_calendar_validate_permit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    span TSTZRANGE;
    permit JSONB;
    issued_ms BIGINT;
    valid_until_ms BIGINT;
BEGIN
    SELECT calendar_window INTO span FROM quota_v2_node_calendar_bindings
      WHERE reservation_id=NEW.reservation_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    permit := convert_from(NEW.signed_envelope,'UTF8')::JSONB -> 'payload';
    issued_ms := (permit->>'issuedAtMs')::BIGINT;
    valid_until_ms := (permit->>'validUntilMs')::BIGINT;
    IF issued_ms IS NULL OR valid_until_ms IS NULL OR valid_until_ms<=issued_ms
       OR issued_ms < (EXTRACT(EPOCH FROM lower(span))*1000)::BIGINT
       OR valid_until_ms > (EXTRACT(EPOCH FROM upper(span))*1000)::BIGINT
       OR NOT span @> clock_timestamp()
    THEN
        RAISE EXCEPTION 'signed reservation outside its original quota window'
            USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER quota_v2_node_calendar_first_cap
BEFORE INSERT ON quota_v2_signed_first_cap_outbox
FOR EACH ROW EXECUTE FUNCTION quota_v2_node_calendar_validate_permit();

CREATE TRIGGER quota_v2_node_calendar_renewal
BEFORE INSERT ON quota_v2_cap_renewals
FOR EACH ROW EXECUTE FUNCTION quota_v2_node_calendar_validate_permit();
