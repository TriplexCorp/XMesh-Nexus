-- A closed calendar window can accept ONLY monotone late debt and
-- terminal conservative burn. It cannot acquire additional spend authority,
-- change its identity or silently erase historical accounting.
--
-- This replaces the broad 0155 guard that allowed arbitrary same-revision
-- reservation UPDATEs, including unbacked ceiling changes.
CREATE OR REPLACE FUNCTION quota_v2_guard_closed_calendar()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- UPDATE must check the ORIGINAL reservation. Checking NEW alone
    -- would let a changed reservation_id bypass an immutable closure.
    IF TG_OP='UPDATE' AND TG_TABLE_NAME='quota_v2_reservations' THEN
        IF NOT EXISTS (
            SELECT 1 FROM quota_v2_calendar_closures
            WHERE reservation_id=OLD.reservation_id
        ) THEN
            RETURN NEW;
        END IF;
    ELSIF NOT EXISTS (
        SELECT 1 FROM quota_v2_calendar_closures
        WHERE reservation_id=NEW.reservation_id
    ) THEN
        RETURN NEW;
    END IF;
    IF TG_TABLE_NAME='quota_v2_reservations' THEN
        IF NEW.user_id=OLD.user_id
           AND NEW.epoch=OLD.epoch
           AND NEW.node_id=OLD.node_id
           AND NEW.meter_epoch=OLD.meter_epoch
           AND NEW.reservation_id=OLD.reservation_id
           AND NEW.revision=OLD.revision
           AND NEW.node_confirmed=OLD.node_confirmed
           AND NEW.valid_until<=OLD.valid_until
           AND NEW.acknowledged_bytes>=OLD.acknowledged_bytes
           AND NEW.conservative_burn_floor_bytes>=OLD.conservative_burn_floor_bytes
           AND NEW.conservative_burned_bytes>=OLD.conservative_burned_bytes
           AND (OLD.conservative_burned_at IS NULL
                OR NEW.conservative_burned_at IS NOT DISTINCT FROM OLD.conservative_burned_at)
           -- Settlement overshoot can extend accounting to cover actually
           -- charged bytes; this is never new discretionary reserve capacity.
           AND NEW.ceiling_bytes>=OLD.ceiling_bytes
           AND NEW.ceiling_bytes<=GREATEST(
               OLD.ceiling_bytes,NEW.acknowledged_bytes)
        THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'calendar reservation is permanently closed'
      USING ERRCODE='23514';
END
$$;
