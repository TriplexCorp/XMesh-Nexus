-- Use the existing panel monthly CDN rule, independently of Node windows.
CREATE TABLE quota_v2_cdn_calendar_bindings (
    reservation_id UUID PRIMARY KEY REFERENCES quota_v2_reservations(reservation_id)
        DEFERRABLE INITIALLY DEFERRED,
    period TEXT NOT NULL CHECK (period = 'monthly'),
    calendar_window TSTZRANGE NOT NULL,
    CHECK (NOT isempty(calendar_window) AND NOT lower_inf(calendar_window) AND NOT upper_inf(calendar_window)
        AND calendar_window = quota_v2_calendar_window(period, lower(calendar_window)))
);

CREATE TRIGGER quota_v2_cdn_calendar_immutable
BEFORE UPDATE OR DELETE ON quota_v2_cdn_calendar_bindings
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE TRIGGER quota_v2_cdn_calendar_no_truncate
BEFORE TRUNCATE ON quota_v2_cdn_calendar_bindings
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

REVOKE ALL ON quota_v2_cdn_calendar_bindings FROM PUBLIC;

CREATE VIEW quota_v2_calendar_bindings AS
    SELECT reservation_id, calendar_window FROM quota_v2_node_calendar_bindings
    UNION ALL
    SELECT reservation_id, calendar_window FROM quota_v2_cdn_calendar_bindings;

CREATE OR REPLACE FUNCTION quota_v2_node_calendar_validate_lease()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME IN ('quota_v2_node_calendar_bindings','quota_v2_cdn_calendar_bindings') THEN
        IF EXISTS (SELECT 1 FROM quota_v2_reservations
                   WHERE reservation_id=NEW.reservation_id
                     AND (ceiling_bytes>0 OR valid_until>upper(NEW.calendar_window))) THEN
            RAISE EXCEPTION 'an issued reservation cannot change its quota window'
                USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END IF;
    IF EXISTS (
        SELECT 1 FROM quota_v2_calendar_bindings b
        WHERE b.reservation_id=NEW.reservation_id AND (
            NEW.valid_until > upper(b.calendar_window)
            OR ((TG_OP = 'INSERT' OR NEW.revision <> OLD.revision)
                AND NOT b.calendar_window @> clock_timestamp())
        )
    ) THEN
        RAISE EXCEPTION 'reservation outside its original quota window'
            USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER quota_v2_cdn_calendar_only_before_issuance
BEFORE INSERT ON quota_v2_cdn_calendar_bindings
FOR EACH ROW EXECUTE FUNCTION quota_v2_node_calendar_validate_lease();

CREATE OR REPLACE FUNCTION quota_v2_node_calendar_validate_permit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    starts_at TIMESTAMPTZ;
    ends_at TIMESTAMPTZ;
    permit JSONB;
    issued_ms BIGINT;
    valid_until_ms BIGINT;
BEGIN
    SELECT max(lower(calendar_window)), min(upper(calendar_window))
      INTO starts_at,ends_at FROM quota_v2_calendar_bindings
      WHERE reservation_id=NEW.reservation_id;
    IF starts_at IS NULL THEN
        RETURN NEW;
    END IF;
    permit := convert_from(NEW.signed_envelope,'UTF8')::JSONB -> 'payload';
    issued_ms := (permit->>'issuedAtMs')::BIGINT;
    valid_until_ms := (permit->>'validUntilMs')::BIGINT;
    IF issued_ms IS NULL OR valid_until_ms IS NULL OR valid_until_ms<=issued_ms
       OR issued_ms < (EXTRACT(EPOCH FROM starts_at)*1000)::BIGINT
       OR valid_until_ms > (EXTRACT(EPOCH FROM ends_at)*1000)::BIGINT
       OR clock_timestamp()<starts_at OR clock_timestamp()>=ends_at
    THEN
        RAISE EXCEPTION 'signed reservation outside its original quota window'
            USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END
$$;

-- CDN-charged traffic is measured in the existing UTC monthly telemetry
-- ledger. Unbound historical V2 capacity remains chargeable conservatively.
CREATE FUNCTION quota_v2_cdn_calendar_remaining(
    p_user BIGINT, p_limit BIGINT, p_at TIMESTAMPTZ
) RETURNS BIGINT LANGUAGE sql STABLE STRICT AS $$
    WITH w AS (SELECT quota_v2_calendar_window('monthly',p_at) AS span)
    SELECT GREATEST((-9223372036854775807)::numeric, p_limit::numeric
      - COALESCE((SELECT SUM(t.quota_uplink_bytes::numeric+t.quota_downlink_bytes)
          FROM user_inbound_traffic_monthly t WHERE t.user_id=p_user
            AND t.month_start=(lower(w.span) AT TIME ZONE 'UTC')::date),0)
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
    FROM w
$$;

REVOKE ALL ON FUNCTION quota_v2_cdn_calendar_remaining(BIGINT,BIGINT,TIMESTAMPTZ) FROM PUBLIC;
