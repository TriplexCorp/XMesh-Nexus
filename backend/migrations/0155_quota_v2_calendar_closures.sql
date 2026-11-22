-- Remember an observed calendar boundary even if the database clock
-- subsequently steps back. This burns no bytes and releases no holds.
CREATE TABLE quota_v2_calendar_closures (
    reservation_id UUID PRIMARY KEY REFERENCES quota_v2_reservations(reservation_id),
    boundary_at TIMESTAMPTZ NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL CHECK (observed_at >= boundary_at)
);

CREATE TRIGGER quota_v2_calendar_closure_immutable
BEFORE UPDATE OR DELETE ON quota_v2_calendar_closures
FOR EACH ROW EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

CREATE TRIGGER quota_v2_calendar_closure_no_truncate
BEFORE TRUNCATE ON quota_v2_calendar_closures
FOR EACH STATEMENT EXECUTE FUNCTION quota_v2_runtime_preflight_immutable();

-- The API holds the user/account locks before calling this function.
-- Lock the affected reservations too, so the boundary observation is
-- ordered against reservation and outbox writers.
CREATE FUNCTION quota_v2_observe_calendar_closures(
    p_user BIGINT, p_node BIGINT, p_epoch UUID
) RETURNS BIGINT LANGUAGE sql AS $$
    WITH observed AS MATERIALIZED (SELECT clock_timestamp() AS at),
    due AS (
        SELECT r.reservation_id, boundary.at AS boundary_at, observed.at AS observed_at
        FROM quota_v2_reservations r
        CROSS JOIN LATERAL (
            SELECT min(upper(b.calendar_window)) AS at
            FROM quota_v2_calendar_bindings b WHERE b.reservation_id=r.reservation_id
        ) boundary
        CROSS JOIN observed
        WHERE r.user_id=p_user AND r.node_id=p_node AND r.epoch=p_epoch
          AND boundary.at<=observed.at
          AND NOT EXISTS (
              SELECT 1 FROM quota_v2_calendar_closures c
              WHERE c.reservation_id=r.reservation_id
          )
        ORDER BY r.reservation_id
        FOR UPDATE OF r
    ), inserted AS (
        INSERT INTO quota_v2_calendar_closures(reservation_id,boundary_at,observed_at)
        SELECT reservation_id,boundary_at,observed_at FROM due
        ON CONFLICT (reservation_id) DO NOTHING
        RETURNING 1
    )
    SELECT count(*) FROM inserted
$$;

CREATE FUNCTION quota_v2_guard_closed_calendar()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Credit and terminal settlement do not change spending revisions or
    -- extend validity. In particular, late WAL may advance its durable floor.
    IF TG_TABLE_NAME='quota_v2_reservations' THEN
        IF NEW.revision=OLD.revision AND NEW.valid_until<=OLD.valid_until
           AND (OLD.node_confirmed OR NOT NEW.node_confirmed) THEN
            RETURN NEW;
        END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM quota_v2_calendar_closures
               WHERE reservation_id=NEW.reservation_id) THEN
        RAISE EXCEPTION 'calendar reservation is permanently closed' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER quota_v2_closed_calendar_reservation
BEFORE UPDATE ON quota_v2_reservations
FOR EACH ROW EXECUTE FUNCTION quota_v2_guard_closed_calendar();

CREATE TRIGGER quota_v2_closed_calendar_first_permit
BEFORE INSERT ON quota_v2_signed_first_cap_outbox
FOR EACH ROW EXECUTE FUNCTION quota_v2_guard_closed_calendar();

CREATE TRIGGER quota_v2_closed_calendar_renewed_permit
BEFORE INSERT ON quota_v2_cap_renewals
FOR EACH ROW EXECUTE FUNCTION quota_v2_guard_closed_calendar();

REVOKE ALL ON quota_v2_calendar_closures FROM PUBLIC;
REVOKE ALL ON FUNCTION quota_v2_observe_calendar_closures(BIGINT,BIGINT,UUID) FROM PUBLIC;
